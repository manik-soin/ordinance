import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mock all external dependencies before importing modules under test ----

vi.mock('../../src/retrieval/query-expansion.js', () => ({
  expandQuery: vi.fn(),
}));

vi.mock('../../src/retrieval/hybrid-search.js', () => ({
  hybridSearch: vi.fn(),
  rrfFuse: vi.fn(),
}));

vi.mock('../../src/retrieval/reranker.js', () => ({
  rerank: vi.fn(),
}));

vi.mock('../../src/retrieval/web-search.js', () => ({
  liveWebSearch: vi.fn(),
}));

vi.mock('../../src/retrieval/follow-up-context.js', () => ({
  contextualizeFollowUpQuery: vi.fn(),
}));

vi.mock('../../src/generator/index.js', () => ({
  generateAnswer: vi.fn(),
}));

vi.mock('../../src/safety/citation-verifier.js', () => ({
  verifyCitations: vi.fn(),
  appendDisclaimer: vi.fn(),
}));

vi.mock('../../src/safety/faithfulness.js', () => ({
  scoreFaithfulness: vi.fn(),
}));

vi.mock('../../src/db/store.js', () => ({
  logQueryAudit: vi.fn(),
  storeChunks: vi.fn(),
  supersedePreviousChunks: vi.fn(),
  getDocumentHash: vi.fn(),
  recordDocumentVersion: vi.fn(),
}));

vi.mock('../../src/scraper/index.js', () => ({
  fetchPdf: vi.fn(),
  storePdf: vi.fn(),
}));

vi.mock('../../src/parser/index.js', () => ({
  parsePdf: vi.fn(),
}));

vi.mock('../../src/chunker/index.js', () => ({
  chunkDocument: vi.fn(),
  chunkPlainText: vi.fn(),
}));

vi.mock('../../src/embedder/index.js', () => ({
  embedChunks: vi.fn(),
}));

vi.mock('../../src/db/pool.js', () => ({
  getPool: vi.fn(),
}));

// ---- Imports (after mocks are registered) ----

import { queryPipeline } from '../../src/pipeline/query.js';
import { ingestSource, ingestSources } from '../../src/pipeline/ingest.js';

import { expandQuery } from '../../src/retrieval/query-expansion.js';
import { hybridSearch, rrfFuse } from '../../src/retrieval/hybrid-search.js';
import { rerank } from '../../src/retrieval/reranker.js';
import { liveWebSearch } from '../../src/retrieval/web-search.js';
import { contextualizeFollowUpQuery } from '../../src/retrieval/follow-up-context.js';
import { generateAnswer } from '../../src/generator/index.js';
import { verifyCitations, appendDisclaimer } from '../../src/safety/citation-verifier.js';
import { scoreFaithfulness } from '../../src/safety/faithfulness.js';
import {
  logQueryAudit,
  storeChunks,
  supersedePreviousChunks,
  getDocumentHash,
  recordDocumentVersion,
} from '../../src/db/store.js';
import { fetchPdf, storePdf } from '../../src/scraper/index.js';
import { parsePdf } from '../../src/parser/index.js';
import { chunkDocument, chunkPlainText } from '../../src/chunker/index.js';
import { embedChunks } from '../../src/embedder/index.js';
import { getPool } from '../../src/db/pool.js';

import type { SearchResult } from '../../src/retrieval/hybrid-search.js';
import type { RegulationSource } from '../../src/sources/buildings-dept.js';

// ---- Helpers ----

function makeSearchResult(overrides?: Partial<SearchResult>): SearchResult {
  return {
    id: 'chunk-1',
    content: 'Fire safety requirements section 4.1',
    score: 0.92,
    source_department: 'BD',
    document_type: 'code_of_practice',
    document_name: 'Fire Safety Code',
    version: '2024',
    section_hierarchy: ['Part I', 'Section 4'],
    page_number: 12,
    cross_references: [],
    search_method: 'hybrid',
    ...overrides,
  };
}

const mockPool = { query: vi.fn() } as unknown as import('pg').Pool;

const testSource: RegulationSource = {
  name: 'Code of Practice for Fire Safety',
  url: 'https://example.com/fire-safety.pdf',
  version: '2024',
  department: 'BD',
  type: 'code_of_practice',
  category: 'fire_safety',
};

// ======================================================================
// queryPipeline tests
// ======================================================================

describe('queryPipeline', () => {
  const mockResults = [makeSearchResult(), makeSearchResult({ id: 'chunk-2', score: 0.85 })];
  const mockCitations = [
    {
      document_name: 'Fire Safety Code',
      section: 'Section 4.1',
      department: 'BD',
      version: '2024',
    },
  ];
  const mockGeneration = {
    answer: 'The minimum fire resistance is 120 minutes.',
    citations: mockCitations,
    model: 'gpt-4o',
    prompt_tokens: 500,
    completion_tokens: 100,
  };
  const mockVerification = {
    totalCitations: 1,
    verifiedCitations: 1,
    phantomCitations: [],
    uncitedClaims: [],
    citationAccuracy: 1,
  };
  const mockFaithfulness = {
    score: 9,
    reasoning: 'All claims grounded',
    flaggedClaims: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks for a happy-path query pipeline run
    vi.mocked(expandQuery).mockResolvedValue([
      'fire resistance requirements',
      'minimum fire rating',
    ]);
    vi.mocked(contextualizeFollowUpQuery).mockImplementation(async (query: string) => query);
    vi.mocked(hybridSearch).mockResolvedValue(mockResults);
    vi.mocked(rrfFuse).mockReturnValue(mockResults);
    vi.mocked(rerank).mockResolvedValue(mockResults);
    vi.mocked(liveWebSearch).mockResolvedValue({
      webResults: [{ title: 'Official BD reference', url: 'https://example.com', source: 'bd.gov.hk', snippet: 'Live source' }],
      supplementaryContext: '[Live Web Sources]\n- Official BD reference (bd.gov.hk): Live source',
    });
    vi.mocked(generateAnswer).mockResolvedValue(mockGeneration);
    vi.mocked(verifyCitations).mockReturnValue(mockVerification);
    vi.mocked(scoreFaithfulness).mockResolvedValue(mockFaithfulness);
    vi.mocked(appendDisclaimer).mockImplementation((a: string) => a + '\n\n---\n**Disclaimer**');
    vi.mocked(logQueryAudit).mockResolvedValue('audit-id-123');
  });

  it('calls all pipeline stages in order and returns correct result', async () => {
    const result = await queryPipeline(mockPool, 'What is the fire resistance requirement?');

    expect(contextualizeFollowUpQuery).toHaveBeenCalledWith(
      'What is the fire resistance requirement?',
      []
    );

    // 1. Query expansion called
    expect(expandQuery).toHaveBeenCalledWith('What is the fire resistance requirement?');

    // 2. Hybrid search: primary query + expanded queries in parallel
    expect(hybridSearch).toHaveBeenCalledTimes(3);

    // 3. RRF fusion called to merge results
    expect(rrfFuse).toHaveBeenCalledTimes(1);

    // 4. Rerank called
    expect(rerank).toHaveBeenCalledWith(
      'What is the fire resistance requirement?',
      expect.any(Array),
      { topK: 5 },
    );

    // 5. Generate answer
    expect(generateAnswer).toHaveBeenCalledWith(
      'What is the fire resistance requirement?',
      mockResults,
      {
        supplementaryContext: '[Live Web Sources]\n- Official BD reference (bd.gov.hk): Live source',
      },
    );

    // 6. Verify citations
    expect(verifyCitations).toHaveBeenCalledWith(
      mockGeneration.answer,
      mockGeneration.citations,
      mockResults,
    );

    // 7. Score faithfulness
    expect(scoreFaithfulness).toHaveBeenCalledWith(
      'What is the fire resistance requirement?',
      mockGeneration.answer,
      mockResults,
    );

    // 8. Append disclaimer
    expect(appendDisclaimer).toHaveBeenCalledWith(mockGeneration.answer);

    // 9. Log audit
    expect(logQueryAudit).toHaveBeenCalledWith(mockPool, expect.objectContaining({
      query: 'What is the fire resistance requirement?',
      model: 'gpt-4o',
    }));

    // Verify returned structure
    expect(result.auditId).toBe('audit-id-123');
    expect(result.citations).toEqual(mockCitations);
    expect(result.verification).toEqual(mockVerification);
    expect(result.faithfulness).toEqual(mockFaithfulness);
    expect(result.model).toBe('gpt-4o');
    expect(result.answer).toContain('Disclaimer');
    expect(typeof result.latencyMs).toBe('number');
  });

  it('skips faithfulness scoring when skipFaithfulness is true', async () => {
    const result = await queryPipeline(mockPool, 'test query', {
      skipFaithfulness: true,
    });

    expect(scoreFaithfulness).not.toHaveBeenCalled();
    expect(result.faithfulness).toEqual({
      score: -1,
      reasoning: 'Skipped',
      flaggedClaims: [],
    });
  });

  it('skips query expansion when useQueryExpansion is false', async () => {
    const result = await queryPipeline(mockPool, 'direct query', {
      useQueryExpansion: false,
    });

    // expandQuery should NOT be called
    expect(expandQuery).not.toHaveBeenCalled();

    // hybridSearch called once with the original query and topK * 2
    expect(hybridSearch).toHaveBeenCalledTimes(1);
    expect(hybridSearch).toHaveBeenCalledWith(mockPool, 'direct query', {
      filter: undefined,
      topK: 10, // 5 * 2
    });

    // rrfFuse should NOT be called (single query path)
    expect(rrfFuse).not.toHaveBeenCalled();

    // Rest of pipeline still executes
    expect(rerank).toHaveBeenCalled();
    expect(generateAnswer).toHaveBeenCalled();
    expect(result.auditId).toBe('audit-id-123');
  });

  it('skips reranker when useReranker is false', async () => {
    const manyResults = Array.from({ length: 8 }, (_, i) =>
      makeSearchResult({ id: `chunk-${i}`, score: 0.9 - i * 0.05 }),
    );
    vi.mocked(hybridSearch).mockResolvedValue(manyResults);

    const result = await queryPipeline(mockPool, 'test', {
      useQueryExpansion: false,
      useReranker: false,
    });

    expect(rerank).not.toHaveBeenCalled();
    // Should slice to topK (default 5) instead
    expect(generateAnswer).toHaveBeenCalledWith('test', manyResults.slice(0, 5), {
      supplementaryContext: '[Live Web Sources]\n- Official BD reference (bd.gov.hk): Live source',
    });
    expect(result.auditId).toBe('audit-id-123');
  });

  it('passes filters and topK through to retrieval', async () => {
    await queryPipeline(mockPool, 'structural steel', {
      useQueryExpansion: false,
      filter: { department: 'BD', documentType: 'code_of_practice' },
      topK: 3,
    });

    expect(hybridSearch).toHaveBeenCalledWith(mockPool, 'structural steel', {
      filter: { department: 'BD', documentType: 'code_of_practice' },
      topK: 6, // 3 * 2
    });
  });

  it('uses conversation history to resolve follow-up queries before retrieval', async () => {
    vi.mocked(contextualizeFollowUpQuery).mockResolvedValue(
      'What are the fire resistance requirements for stair enclosures in residential buildings?'
    );

    await queryPipeline(mockPool, 'What about residential buildings?', {
      useQueryExpansion: false,
      history: [
        { role: 'user', content: 'What are the fire resistance requirements for stair enclosures?' },
        { role: 'assistant', content: 'They depend on the occupancy type.' },
      ],
    });

    expect(contextualizeFollowUpQuery).toHaveBeenCalledWith(
      'What about residential buildings?',
      [
        { role: 'user', content: 'What are the fire resistance requirements for stair enclosures?' },
        { role: 'assistant', content: 'They depend on the occupancy type.' },
      ]
    );
    expect(hybridSearch).toHaveBeenCalledWith(
      mockPool,
      'What are the fire resistance requirements for stair enclosures in residential buildings?',
      {
        filter: undefined,
        topK: 10,
      }
    );
    expect(generateAnswer).toHaveBeenCalledWith(
      'What are the fire resistance requirements for stair enclosures in residential buildings?',
      mockResults,
      {
        supplementaryContext: '[Live Web Sources]\n- Official BD reference (bd.gov.hk): Live source',
      }
    );
  });
});

// ======================================================================
// ingestSource tests
// ======================================================================

describe('ingestSource', () => {
  const mockBuffer = Buffer.from('fake pdf content');
  const mockHash = 'sha256-abc123';
  const mockParsed = {
    title: 'Fire Safety Code',
    fullText: 'Full text of the document...',
    pages: [{ pageNumber: 1, text: 'Page 1 text' }],
    sections: [
      {
        title: 'Part I',
        level: 1,
        content: 'Part I content with details about fire resistance.',
        pageNumber: 1,
        children: [],
      },
    ],
    pageCount: 1,
  };
  const mockChunks = [
    {
      content: 'Chunk 1 content',
      metadata: {
        source_department: 'BD',
        document_type: 'code_of_practice',
        document_name: 'Code of Practice for Fire Safety',
        version: '2024',
        section_hierarchy: ['Part I'],
        page_number: 1,
        is_current: true,
        cross_references: [],
        content_hash: mockHash,
        ingested_at: '2024-01-01T00:00:00.000Z',
      },
    },
  ];
  const mockEmbeddedChunks = [
    {
      ...mockChunks[0],
      embedding: [0.1, 0.2, 0.3],
    },
  ];

  const mockPoolInstance = { query: vi.fn() } as unknown as import('pg').Pool;

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getPool).mockReturnValue(mockPoolInstance);
    vi.mocked(fetchPdf).mockResolvedValue({ buffer: mockBuffer, contentHash: mockHash });
    vi.mocked(getDocumentHash).mockResolvedValue(null); // no previous version
    vi.mocked(storePdf).mockResolvedValue(undefined as never);
    vi.mocked(parsePdf).mockResolvedValue(mockParsed);
    vi.mocked(chunkDocument).mockReturnValue(mockChunks);
    vi.mocked(embedChunks).mockResolvedValue(mockEmbeddedChunks);
    vi.mocked(supersedePreviousChunks).mockResolvedValue(0);
    vi.mocked(storeChunks).mockResolvedValue(['id-1']);
    vi.mocked(recordDocumentVersion).mockResolvedValue('version-id-1');
  });

  it('runs full ingestion pipeline for a new document', async () => {
    const result = await ingestSource(testSource);

    expect(result.status).toBe('ingested');
    expect(result.chunksCreated).toBe(1);
    expect(result.contentHash).toBe(mockHash);
    expect(result.source).toBe(testSource);
    expect(typeof result.durationMs).toBe('number');

    // Verify call order
    expect(fetchPdf).toHaveBeenCalledWith(testSource.url);
    expect(getDocumentHash).toHaveBeenCalledWith(mockPoolInstance, testSource.name, testSource.department);
    expect(storePdf).toHaveBeenCalledWith(mockBuffer, './data/pdfs', testSource);
    expect(parsePdf).toHaveBeenCalledWith(mockBuffer);
    expect(chunkDocument).toHaveBeenCalledWith(mockParsed.sections, testSource, mockHash);
    expect(embedChunks).toHaveBeenCalledWith(mockChunks);
    expect(supersedePreviousChunks).toHaveBeenCalledWith(mockPoolInstance, testSource.name, testSource.department);
    expect(storeChunks).toHaveBeenCalledWith(mockPoolInstance, mockEmbeddedChunks);
    expect(recordDocumentVersion).toHaveBeenCalledWith(
      mockPoolInstance,
      testSource.name,
      testSource.department,
      testSource.version,
      mockHash,
      testSource.url,
      1,
    );
  });

  it('returns unchanged when content hash matches previous version', async () => {
    vi.mocked(getDocumentHash).mockResolvedValue(mockHash); // same hash

    const result = await ingestSource(testSource);

    expect(result.status).toBe('unchanged');
    expect(result.chunksCreated).toBe(0);
    expect(result.contentHash).toBe(mockHash);

    // Should not proceed to parsing, chunking, or storing
    expect(parsePdf).not.toHaveBeenCalled();
    expect(chunkDocument).not.toHaveBeenCalled();
    expect(embedChunks).not.toHaveBeenCalled();
    expect(storeChunks).not.toHaveBeenCalled();
  });

  it('force re-ingests even when hash matches', async () => {
    vi.mocked(getDocumentHash).mockResolvedValue(mockHash); // same hash

    const result = await ingestSource(testSource, { forceReIngest: true });

    expect(result.status).toBe('ingested');
    // getDocumentHash should NOT be called when forceReIngest is true
    expect(getDocumentHash).not.toHaveBeenCalled();
    expect(parsePdf).toHaveBeenCalled();
    expect(storeChunks).toHaveBeenCalled();
  });

  it('falls back to chunkPlainText when sections are empty', async () => {
    vi.mocked(parsePdf).mockResolvedValue({
      ...mockParsed,
      sections: [],
    });
    vi.mocked(chunkPlainText).mockReturnValue(mockChunks);

    const result = await ingestSource(testSource);

    expect(result.status).toBe('ingested');
    expect(chunkDocument).not.toHaveBeenCalled();
    expect(chunkPlainText).toHaveBeenCalledWith(mockParsed.fullText, testSource, mockHash);
  });

  it('returns failed status when fetchPdf throws', async () => {
    vi.mocked(fetchPdf).mockRejectedValue(new Error('Network timeout'));

    const result = await ingestSource(testSource);

    expect(result.status).toBe('failed');
    expect(result.error).toBe('Network timeout');
    expect(result.chunksCreated).toBe(0);
    expect(result.contentHash).toBe('');
  });

  it('returns failed status when parsePdf throws', async () => {
    vi.mocked(parsePdf).mockRejectedValue(new Error('Corrupted PDF'));

    const result = await ingestSource(testSource);

    expect(result.status).toBe('failed');
    expect(result.error).toBe('Corrupted PDF');
    expect(storeChunks).not.toHaveBeenCalled();
  });

  it('uses custom storageDir when provided', async () => {
    await ingestSource(testSource, { storageDir: '/tmp/pdfs' });

    expect(storePdf).toHaveBeenCalledWith(mockBuffer, '/tmp/pdfs', testSource);
  });
});

// ======================================================================
// ingestSources tests
// ======================================================================

describe('ingestSources', () => {
  const mockBuffer = Buffer.from('fake pdf content');
  const mockHash = 'sha256-abc123';
  const mockParsed = {
    title: 'Fire Safety Code',
    fullText: 'Full text of the document...',
    pages: [{ pageNumber: 1, text: 'Page 1 text' }],
    sections: [
      {
        title: 'Part I',
        level: 1,
        content: 'Part I content with details about fire resistance.',
        pageNumber: 1,
        children: [],
      },
    ],
    pageCount: 1,
  };
  const mockChunks = [
    {
      content: 'Chunk 1 content',
      metadata: {
        source_department: 'BD',
        document_type: 'code_of_practice',
        document_name: 'Code of Practice for Fire Safety',
        version: '2024',
        section_hierarchy: ['Part I'],
        page_number: 1,
        is_current: true,
        cross_references: [],
        content_hash: mockHash,
        ingested_at: '2024-01-01T00:00:00.000Z',
      },
    },
  ];
  const mockEmbeddedChunks = [
    {
      ...mockChunks[0],
      embedding: [0.1, 0.2, 0.3],
    },
  ];

  const mockPoolInstance = { query: vi.fn() } as unknown as import('pg').Pool;

  const sourceA: RegulationSource = {
    name: 'Doc A',
    url: 'https://example.com/a.pdf',
    version: '2024',
    department: 'BD',
    type: 'code_of_practice',
    category: 'fire_safety',
  };

  const sourceB: RegulationSource = {
    name: 'Doc B',
    url: 'https://example.com/b.pdf',
    version: '2024',
    department: 'BD',
    type: 'code_of_practice',
    category: 'structural',
  };

  const sourceC: RegulationSource = {
    name: 'Doc C',
    url: 'https://example.com/c.pdf',
    version: '2024',
    department: 'BD',
    type: 'code_of_practice',
    category: 'structural',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getPool).mockReturnValue(mockPoolInstance);
    vi.mocked(fetchPdf).mockResolvedValue({ buffer: mockBuffer, contentHash: mockHash });
    vi.mocked(getDocumentHash).mockResolvedValue(null);
    vi.mocked(storePdf).mockResolvedValue(undefined as never);
    vi.mocked(parsePdf).mockResolvedValue(mockParsed);
    vi.mocked(chunkDocument).mockReturnValue(mockChunks);
    vi.mocked(embedChunks).mockResolvedValue(mockEmbeddedChunks);
    vi.mocked(supersedePreviousChunks).mockResolvedValue(0);
    vi.mocked(storeChunks).mockResolvedValue(['id-1']);
    vi.mocked(recordDocumentVersion).mockResolvedValue('version-id-1');
  });

  it('processes multiple sources and returns all results', async () => {
    const results = await ingestSources([sourceA, sourceB, sourceC]);

    expect(results).toHaveLength(3);
    expect(results[0].source).toBe(sourceA);
    expect(results[1].source).toBe(sourceB);
    expect(results[2].source).toBe(sourceC);
    expect(results.every((r) => r.status === 'ingested')).toBe(true);
    expect(fetchPdf).toHaveBeenCalledTimes(3);
  });

  it('respects concurrency parameter (batches of 2)', async () => {
    // Track the order of calls to detect batching
    const callOrder: string[] = [];

    vi.mocked(fetchPdf).mockImplementation(async (url: string) => {
      callOrder.push(url);
      return { buffer: mockBuffer, contentHash: mockHash };
    });

    await ingestSources([sourceA, sourceB, sourceC], 2);

    // All 3 should have been called
    expect(callOrder).toHaveLength(3);
    // First batch: sourceA and sourceB; second batch: sourceC
    expect(callOrder[0]).toBe(sourceA.url);
    expect(callOrder[1]).toBe(sourceB.url);
    expect(callOrder[2]).toBe(sourceC.url);
  });

  it('handles mixed success/failure across batches', async () => {
    // sourceA succeeds, sourceB fails, sourceC succeeds
    vi.mocked(fetchPdf)
      .mockResolvedValueOnce({ buffer: mockBuffer, contentHash: mockHash })
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ buffer: mockBuffer, contentHash: mockHash });

    const results = await ingestSources([sourceA, sourceB, sourceC], 2);

    expect(results).toHaveLength(3);
    expect(results[0].status).toBe('ingested');
    expect(results[1].status).toBe('failed');
    expect(results[1].error).toBe('Network error');
    expect(results[2].status).toBe('ingested');
  });

  it('returns empty array for empty sources list', async () => {
    const results = await ingestSources([]);

    expect(results).toEqual([]);
    expect(fetchPdf).not.toHaveBeenCalled();
  });
});
