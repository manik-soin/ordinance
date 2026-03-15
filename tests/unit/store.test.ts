import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pg from 'pg';
import {
  storeChunks,
  supersedePreviousChunks,
  getDocumentHash,
  recordDocumentVersion,
  logQueryAudit,
  getSourceStats,
} from '../../src/db/store.js';
import type { EmbeddedChunk } from '../../src/embedder/index.js';

// ---- Helpers ----

function createMockPool() {
  return {
    query: vi.fn(),
  } as unknown as pg.Pool & { query: ReturnType<typeof vi.fn> };
}

function makeEmbeddedChunk(overrides?: Partial<EmbeddedChunk>): EmbeddedChunk {
  return {
    content: 'Fire resistance requirements for structural elements.',
    embedding: [0.1, 0.2, 0.3],
    metadata: {
      source_department: 'BD',
      document_type: 'code_of_practice',
      document_name: 'Fire Safety Code',
      version: '2024',
      effective_date: '2024-01-01',
      section_hierarchy: ['Part I', 'Section 4'],
      page_number: 12,
      is_current: true,
      cross_references: ['Cap 123', 'PNAP 204'],
      content_hash: 'abc123',
      ingested_at: '2024-01-15T10:00:00.000Z',
    },
    ...overrides,
  };
}

// ======================================================================
// storeChunks
// ======================================================================

describe('storeChunks', () => {
  let pool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    pool = createMockPool();
  });

  it('inserts each chunk and returns generated IDs', async () => {
    // Batched insert returns all IDs in one query
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'uuid-1' }, { id: 'uuid-2' }], rowCount: 2 });

    const chunks = [
      makeEmbeddedChunk(),
      makeEmbeddedChunk({ content: 'Second chunk content', embedding: [0.4, 0.5, 0.6] }),
    ];

    const ids = await storeChunks(pool as unknown as pg.Pool, chunks);

    expect(ids).toEqual(['uuid-1', 'uuid-2']);
    expect(pool.query).toHaveBeenCalledTimes(1); // Batched into single INSERT
  });

  it('passes correct SQL and parameters for a chunk', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'uuid-1' }], rowCount: 1 });

    const chunk = makeEmbeddedChunk();
    await storeChunks(pool as unknown as pg.Pool, [chunk]);

    const [sql, params] = pool.query.mock.calls[0];

    // Verify SQL contains INSERT INTO regulation_chunks
    expect(sql).toContain('INSERT INTO regulation_chunks');
    expect(sql).toContain('RETURNING id');

    // Verify parameters match chunk data
    expect(params[0]).toBe(chunk.content);
    expect(params[1]).toBe('[0.1,0.2,0.3]'); // embedding serialized
    expect(params[2]).toBe('BD'); // source_department
    expect(params[3]).toBe('code_of_practice'); // document_type
    expect(params[4]).toBe('Fire Safety Code'); // document_name
    expect(params[5]).toBe('2024'); // version
    expect(params[6]).toBe('2024-01-01'); // effective_date
    expect(params[7]).toEqual(['Part I', 'Section 4']); // section_hierarchy
    expect(params[8]).toBe(12); // page_number
    expect(params[9]).toBe(true); // is_current
    expect(params[10]).toEqual(['Cap 123', 'PNAP 204']); // cross_references
    expect(params[11]).toBe('abc123'); // content_hash
    expect(params[12]).toBe('2024-01-15T10:00:00.000Z'); // ingested_at
  });

  it('returns empty array for empty input', async () => {
    const ids = await storeChunks(pool as unknown as pg.Pool, []);

    expect(ids).toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('passes null for missing effective_date', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'uuid-1' }], rowCount: 1 });

    const chunk = makeEmbeddedChunk();
    chunk.metadata.effective_date = undefined;
    await storeChunks(pool as unknown as pg.Pool, [chunk]);

    const [, params] = pool.query.mock.calls[0];
    expect(params[6]).toBeNull(); // effective_date should be null
  });
});

// ======================================================================
// supersedePreviousChunks
// ======================================================================

describe('supersedePreviousChunks', () => {
  let pool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    pool = createMockPool();
  });

  it('executes UPDATE query with correct parameters', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 5 });

    const count = await supersedePreviousChunks(
      pool as unknown as pg.Pool,
      'Fire Safety Code',
      'BD',
    );

    expect(count).toBe(5);
    expect(pool.query).toHaveBeenCalledTimes(1);

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('UPDATE regulation_chunks');
    expect(sql).toContain('SET is_current = false');
    expect(sql).toContain('document_name = $1');
    expect(sql).toContain('source_department = $2');
    expect(sql).toContain('is_current = true');
    expect(params).toEqual(['Fire Safety Code', 'BD']);
  });

  it('returns 0 when no rows are updated', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const count = await supersedePreviousChunks(
      pool as unknown as pg.Pool,
      'Nonexistent Doc',
      'BD',
    );

    expect(count).toBe(0);
  });

  it('returns 0 when rowCount is null', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: null });

    const count = await supersedePreviousChunks(
      pool as unknown as pg.Pool,
      'Fire Safety Code',
      'BD',
    );

    expect(count).toBe(0);
  });
});

// ======================================================================
// getDocumentHash
// ======================================================================

describe('getDocumentHash', () => {
  let pool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    pool = createMockPool();
  });

  it('returns hash when a document version exists', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ content_hash: 'sha256-existing-hash' }],
      rowCount: 1,
    });

    const hash = await getDocumentHash(
      pool as unknown as pg.Pool,
      'Fire Safety Code',
      'BD',
    );

    expect(hash).toBe('sha256-existing-hash');

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('SELECT content_hash FROM document_versions');
    expect(sql).toContain("status = 'current'");
    expect(sql).toContain('ORDER BY fetched_at DESC LIMIT 1');
    expect(params).toEqual(['Fire Safety Code', 'BD']);
  });

  it('returns null when no document version exists', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const hash = await getDocumentHash(
      pool as unknown as pg.Pool,
      'New Document',
      'BD',
    );

    expect(hash).toBeNull();
  });
});

// ======================================================================
// recordDocumentVersion
// ======================================================================

describe('recordDocumentVersion', () => {
  let pool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    pool = createMockPool();
  });

  it('supersedes old version and inserts new one', async () => {
    // First call: UPDATE supersede
    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      // Second call: INSERT new version
      .mockResolvedValueOnce({ rows: [{ id: 'new-version-id' }], rowCount: 1 });

    const id = await recordDocumentVersion(
      pool as unknown as pg.Pool,
      'Fire Safety Code',
      'BD',
      '2024',
      'sha256-newhash',
      'https://example.com/fire.pdf',
      42,
    );

    expect(id).toBe('new-version-id');
    expect(pool.query).toHaveBeenCalledTimes(2);

    // Verify supersede query
    const [supersedeSQL, supersedeParams] = pool.query.mock.calls[0];
    expect(supersedeSQL).toContain('UPDATE document_versions');
    expect(supersedeSQL).toContain("SET status = 'superseded'");
    expect(supersedeSQL).toContain("status = 'current'");
    expect(supersedeParams).toEqual(['Fire Safety Code', 'BD']);

    // Verify insert query
    const [insertSQL, insertParams] = pool.query.mock.calls[1];
    expect(insertSQL).toContain('INSERT INTO document_versions');
    expect(insertSQL).toContain('RETURNING id');
    expect(insertParams).toEqual([
      'Fire Safety Code',
      'BD',
      '2024',
      'sha256-newhash',
      'https://example.com/fire.pdf',
      42,
    ]);
  });
});

// ======================================================================
// logQueryAudit
// ======================================================================

describe('logQueryAudit', () => {
  let pool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    pool = createMockPool();
  });

  it('inserts audit record with correct parameters and returns ID', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'audit-uuid-1' }], rowCount: 1 });

    const auditData = {
      query: 'What are the fire exit requirements?',
      filters: { department: 'BD' } as Record<string, unknown>,
      chunkIds: ['chunk-1', 'chunk-2'],
      response: 'The fire exit must be at least 1.05m wide.',
      citations: [{ document_name: 'Fire Safety Code', section: '4.1' }],
      faithfulnessScore: 8.5,
      citationAccuracy: 1.0,
      model: 'gpt-4o',
      latencyMs: 1234,
    };

    const id = await logQueryAudit(pool as unknown as pg.Pool, auditData);

    expect(id).toBe('audit-uuid-1');
    expect(pool.query).toHaveBeenCalledTimes(1);

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO query_audit_log');
    expect(sql).toContain('RETURNING id');

    expect(params[0]).toBe(auditData.query);
    expect(params[1]).toBe(JSON.stringify({ department: 'BD' }));
    expect(params[2]).toEqual(['chunk-1', 'chunk-2']);
    expect(params[3]).toBe(auditData.response);
    expect(params[4]).toBe(JSON.stringify(auditData.citations));
    expect(params[5]).toBe(8.5);
    expect(params[6]).toBe(1.0);
    expect(params[7]).toBe('gpt-4o');
    expect(params[8]).toBe(1234);
  });

  it('serializes empty filters as empty object', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'audit-uuid-2' }], rowCount: 1 });

    await logQueryAudit(pool as unknown as pg.Pool, {
      query: 'test',
      chunkIds: [],
      response: 'answer',
      citations: [],
      faithfulnessScore: 0,
      citationAccuracy: 0,
      model: 'gpt-4o',
      latencyMs: 100,
    });

    const [, params] = pool.query.mock.calls[0];
    expect(params[1]).toBe('{}'); // filters serialized as empty object
  });
});

// ======================================================================
// getSourceStats
// ======================================================================

describe('getSourceStats', () => {
  let pool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    pool = createMockPool();
  });

  it('returns aggregated stats from the query', async () => {
    const mockRows = [
      {
        department: 'BD',
        document_count: 5,
        chunk_count: 120,
        last_updated: '2024-01-15T10:00:00.000Z',
      },
      {
        department: 'FSD',
        document_count: 3,
        chunk_count: 80,
        last_updated: '2024-01-10T08:00:00.000Z',
      },
    ];
    pool.query.mockResolvedValueOnce({ rows: mockRows, rowCount: 2 });

    const stats = await getSourceStats(pool as unknown as pg.Pool);

    expect(stats).toEqual(mockRows);
    expect(stats).toHaveLength(2);
    expect(stats[0].department).toBe('BD');
    expect(stats[1].chunk_count).toBe(80);

    const [sql] = pool.query.mock.calls[0];
    expect(sql).toContain('SELECT');
    expect(sql).toContain('source_department');
    expect(sql).toContain('COUNT(DISTINCT document_name)');
    expect(sql).toContain('COUNT(*)');
    expect(sql).toContain('MAX(ingested_at)');
    expect(sql).toContain('is_current = true');
    expect(sql).toContain('GROUP BY source_department');
  });

  it('returns empty array when no data exists', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const stats = await getSourceStats(pool as unknown as pg.Pool);

    expect(stats).toEqual([]);
  });
});
