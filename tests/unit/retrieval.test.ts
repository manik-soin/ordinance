import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rrfFuse, vectorSearch, keywordSearch, hybridSearch } from '../../src/retrieval/hybrid-search.js';
import type { SearchResult, SearchFilter } from '../../src/retrieval/hybrid-search.js';

function makeResult(id: string, score: number, method: 'vector' | 'keyword' = 'vector'): SearchResult {
  return {
    id,
    content: `Content for ${id}`,
    score,
    source_department: 'BD',
    document_type: 'code_of_practice',
    document_name: 'Test Code',
    version: '2024',
    section_hierarchy: ['Section 1'],
    page_number: 1,
    cross_references: [],
    search_method: method,
  };
}

describe('Hybrid Retrieval', () => {
  describe('RRF Fusion', () => {
    it('fuses vector and keyword results', () => {
      const vectorResults = [
        makeResult('a', 0.9),
        makeResult('b', 0.8),
        makeResult('c', 0.7),
      ];

      const keywordResults = [
        makeResult('b', 5.0, 'keyword'),
        makeResult('d', 4.0, 'keyword'),
        makeResult('a', 3.0, 'keyword'),
      ];

      const fused = rrfFuse(vectorResults, keywordResults, 5);

      // 'a' and 'b' appear in both → should rank higher
      expect(fused.length).toBeLessThanOrEqual(5);

      const ids = fused.map((r) => r.id);
      expect(ids).toContain('a');
      expect(ids).toContain('b');
    });

    it('marks results appearing in both lists as hybrid', () => {
      const vectorResults = [makeResult('a', 0.9)];
      const keywordResults = [makeResult('a', 5.0, 'keyword')];

      const fused = rrfFuse(vectorResults, keywordResults, 5);
      expect(fused[0].search_method).toBe('hybrid');
    });

    it('deduplicates across result sets', () => {
      const vectorResults = [
        makeResult('a', 0.9),
        makeResult('b', 0.8),
      ];
      const keywordResults = [
        makeResult('a', 5.0, 'keyword'),
        makeResult('b', 4.0, 'keyword'),
      ];

      const fused = rrfFuse(vectorResults, keywordResults, 10);
      const ids = fused.map((r) => r.id);
      const uniqueIds = [...new Set(ids)];
      expect(ids.length).toBe(uniqueIds.length);
    });

    it('respects topK limit', () => {
      const vectorResults = Array.from({ length: 10 }, (_, i) =>
        makeResult(`v${i}`, 1 - i * 0.1)
      );
      const keywordResults = Array.from({ length: 10 }, (_, i) =>
        makeResult(`k${i}`, 10 - i)
      );

      const fused = rrfFuse(vectorResults, keywordResults, 3);
      expect(fused.length).toBe(3);
    });

    it('handles empty vector results', () => {
      const keywordResults = [makeResult('a', 5.0, 'keyword')];
      const fused = rrfFuse([], keywordResults, 5);
      expect(fused.length).toBe(1);
      expect(fused[0].id).toBe('a');
    });

    it('handles empty keyword results', () => {
      const vectorResults = [makeResult('a', 0.9)];
      const fused = rrfFuse(vectorResults, [], 5);
      expect(fused.length).toBe(1);
      expect(fused[0].id).toBe('a');
    });

    it('handles both empty', () => {
      const fused = rrfFuse([], [], 5);
      expect(fused).toEqual([]);
    });

    it('ranks items appearing in both lists higher than single-list items', () => {
      // 'shared' appears in both, 'vector-only' and 'keyword-only' appear in one each
      const vectorResults = [
        makeResult('shared', 0.9),
        makeResult('vector-only', 0.8),
      ];
      const keywordResults = [
        makeResult('keyword-only', 5.0, 'keyword'),
        makeResult('shared', 4.0, 'keyword'),
      ];

      const fused = rrfFuse(vectorResults, keywordResults, 5);
      expect(fused[0].id).toBe('shared');
    });

    it('preserves content and metadata from original results', () => {
      const vectorResults = [
        {
          ...makeResult('a', 0.9),
          document_name: 'Fire Safety Code',
          source_department: 'BD',
          version: '2024 Edition',
          section_hierarchy: ['Part III', 'Section 17'],
          page_number: 42,
          cross_references: ['Cap. 123'],
        },
      ];

      const fused = rrfFuse(vectorResults, [], 5);
      expect(fused[0].document_name).toBe('Fire Safety Code');
      expect(fused[0].section_hierarchy).toEqual(['Part III', 'Section 17']);
      expect(fused[0].page_number).toBe(42);
      expect(fused[0].cross_references).toEqual(['Cap. 123']);
    });

    it('assigns RRF scores based on rank position', () => {
      const vectorResults = [
        makeResult('first', 0.99),
        makeResult('second', 0.50),
      ];

      const fused = rrfFuse(vectorResults, [], 5);
      // First result: 1/(60+0+1) = 1/61
      // Second result: 1/(60+1+1) = 1/62
      expect(fused[0].score).toBeGreaterThan(fused[1].score);
      expect(fused[0].score).toBeCloseTo(1 / 61, 5);
      expect(fused[1].score).toBeCloseTo(1 / 62, 5);
    });

    it('handles large result sets efficiently', () => {
      const vectorResults = Array.from({ length: 100 }, (_, i) =>
        makeResult(`v${i}`, 1 - i * 0.01)
      );
      const keywordResults = Array.from({ length: 100 }, (_, i) =>
        makeResult(`k${i}`, 100 - i)
      );

      const fused = rrfFuse(vectorResults, keywordResults, 10);
      expect(fused.length).toBe(10);
      // Scores should be monotonically decreasing
      for (let i = 1; i < fused.length; i++) {
        expect(fused[i].score).toBeLessThanOrEqual(fused[i - 1].score);
      }
    });
  });

  /* ------------------------------------------------------------------ */
  /*  vectorSearch                                                       */
  /* ------------------------------------------------------------------ */
  describe('vectorSearch', () => {
    function makeDbRow(id: string, score: number) {
      return {
        id,
        content: `Content for ${id}`,
        score,
        source_department: 'BD',
        document_type: 'code_of_practice',
        document_name: 'Test Code',
        version: '2024',
        section_hierarchy: ['Section 1'],
        page_number: 1,
        cross_references: [],
      };
    }

    function makeMockPool(rows: Record<string, unknown>[]) {
      return { query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }) } as any;
    }

    it('passes embedding and limit to the SQL query', async () => {
      const pool = makeMockPool([makeDbRow('r1', 0.95)]);
      const embedding = [0.1, 0.2, 0.3];

      const results = await vectorSearch(pool, 'test query', 5, {}, embedding);

      expect(pool.query).toHaveBeenCalledOnce();
      const [sql, params] = pool.query.mock.calls[0];
      // First param is the embedding string
      expect(params[0]).toBe('[0.1,0.2,0.3]');
      // Last param is the limit k
      expect(params[params.length - 1]).toBe(5);
      // SQL should select from regulation_chunks with cosine distance
      expect(sql).toContain('regulation_chunks');
      expect(sql).toContain('<=>');

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('r1');
      expect(results[0].search_method).toBe('vector');
    });

    it('applies department filter', async () => {
      const pool = makeMockPool([]);
      const filter: SearchFilter = { department: 'FSD' };

      await vectorSearch(pool, 'fire safety', 10, filter, [0.1]);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('source_department = $');
      expect(params).toContain('FSD');
    });

    it('applies documentType filter', async () => {
      const pool = makeMockPool([]);
      const filter: SearchFilter = { documentType: 'code_of_practice' };

      await vectorSearch(pool, 'query', 5, filter, [0.1]);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('document_type = $');
      expect(params).toContain('code_of_practice');
    });

    it('applies capNumber filter', async () => {
      const pool = makeMockPool([]);
      const filter: SearchFilter = { capNumber: '123' };

      await vectorSearch(pool, 'query', 5, filter, [0.1]);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('cap_number = $');
      expect(params).toContain('123');
    });

    it('applies isCurrent filter when explicitly set to false', async () => {
      const pool = makeMockPool([]);
      const filter: SearchFilter = { isCurrent: false };

      await vectorSearch(pool, 'query', 5, filter, [0.1]);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('is_current = $');
      expect(params).toContain(false);
    });

    it('defaults isCurrent to true when not specified', async () => {
      const pool = makeMockPool([]);

      await vectorSearch(pool, 'query', 5, {}, [0.1]);

      const [sql] = pool.query.mock.calls[0];
      expect(sql).toContain('is_current = true');
    });

    it('applies multiple filters simultaneously', async () => {
      const pool = makeMockPool([]);
      const filter: SearchFilter = {
        department: 'BD',
        documentType: 'ordinance',
        capNumber: '123',
        isCurrent: true,
      };

      await vectorSearch(pool, 'query', 5, filter, [0.1]);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('source_department = $');
      expect(sql).toContain('document_type = $');
      expect(sql).toContain('cap_number = $');
      expect(sql).toContain('is_current = $');
      expect(params).toContain('BD');
      expect(params).toContain('ordinance');
      expect(params).toContain('123');
      expect(params).toContain(true);
    });

    it('returns empty array when no rows match', async () => {
      const pool = makeMockPool([]);

      const results = await vectorSearch(pool, 'query', 5, {}, [0.1]);

      expect(results).toEqual([]);
    });

    it('maps rows to SearchResult with correct fields and defaults', async () => {
      const row = {
        id: 'r1',
        content: 'Some content',
        score: 0.85,
        source_department: 'BD',
        document_type: 'code_of_practice',
        document_name: 'Fire Safety Code',
        version: null,
        section_hierarchy: null,
        page_number: null,
        cross_references: null,
      };
      const pool = makeMockPool([row]);

      const results = await vectorSearch(pool, 'query', 5, {}, [0.1]);

      expect(results[0].version).toBe('');
      expect(results[0].section_hierarchy).toEqual([]);
      expect(results[0].page_number).toBe(0);
      expect(results[0].cross_references).toEqual([]);
      expect(results[0].search_method).toBe('vector');
    });
  });

  /* ------------------------------------------------------------------ */
  /*  keywordSearch                                                      */
  /* ------------------------------------------------------------------ */
  describe('keywordSearch', () => {
    function makeDbRow(id: string, score: number) {
      return {
        id,
        content: `Content for ${id}`,
        score,
        source_department: 'BD',
        document_type: 'code_of_practice',
        document_name: 'Test Code',
        version: '2024',
        section_hierarchy: ['Section 1'],
        page_number: 1,
        cross_references: [],
      };
    }

    function makeMockPool(rows: Record<string, unknown>[]) {
      return { query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }) } as any;
    }

    it('passes query text and limit to the SQL query', async () => {
      const pool = makeMockPool([makeDbRow('r1', 3.5)]);

      const results = await keywordSearch(pool, 'fire safety', 5, {});

      expect(pool.query).toHaveBeenCalledOnce();
      const [sql, params] = pool.query.mock.calls[0];
      // First param is the query text
      expect(params[0]).toBe('fire safety');
      // Last param is the limit k
      expect(params[params.length - 1]).toBe(5);
      // SQL should use full-text search constructs
      expect(sql).toContain('plainto_tsquery');
      expect(sql).toContain('ts_rank_cd');
      expect(sql).toContain('search_vector');

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('r1');
      expect(results[0].search_method).toBe('keyword');
    });

    it('applies department filter', async () => {
      const pool = makeMockPool([]);

      await keywordSearch(pool, 'query', 10, { department: 'FSD' });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('source_department = $');
      expect(params).toContain('FSD');
    });

    it('applies multiple filters simultaneously', async () => {
      const pool = makeMockPool([]);
      const filter: SearchFilter = {
        department: 'BD',
        documentType: 'ordinance',
        capNumber: '123',
        isCurrent: true,
      };

      await keywordSearch(pool, 'query', 5, filter);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('source_department = $');
      expect(sql).toContain('document_type = $');
      expect(sql).toContain('cap_number = $');
      expect(sql).toContain('is_current = $');
      expect(params).toContain('BD');
      expect(params).toContain('ordinance');
      expect(params).toContain('123');
      expect(params).toContain(true);
    });

    it('returns empty array when no rows match', async () => {
      const pool = makeMockPool([]);

      const results = await keywordSearch(pool, 'nonexistent', 5, {});

      expect(results).toEqual([]);
    });

    it('maps rows to SearchResult with correct defaults for null fields', async () => {
      const row = {
        id: 'r1',
        content: 'Content',
        score: 2.5,
        source_department: 'BD',
        document_type: 'code_of_practice',
        document_name: 'Code',
        version: null,
        section_hierarchy: null,
        page_number: null,
        cross_references: null,
      };
      const pool = makeMockPool([row]);

      const results = await keywordSearch(pool, 'query', 5, {});

      expect(results[0].version).toBe('');
      expect(results[0].section_hierarchy).toEqual([]);
      expect(results[0].page_number).toBe(0);
      expect(results[0].cross_references).toEqual([]);
      expect(results[0].search_method).toBe('keyword');
    });
  });

  /* ------------------------------------------------------------------ */
  /*  hybridSearch                                                       */
  /* ------------------------------------------------------------------ */
  describe('hybridSearch', () => {
    function makeMockPool(rows: Record<string, unknown>[]) {
      return { query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }) } as any;
    }

    function makeDbRow(id: string, score: number) {
      return {
        id,
        content: `Content for ${id}`,
        score,
        source_department: 'BD',
        document_type: 'code_of_practice',
        document_name: 'Test Code',
        version: '2024',
        section_hierarchy: ['Section 1'],
        page_number: 1,
        cross_references: [],
      };
    }

    it('calls both vector and keyword search and returns fused results', async () => {
      const pool = makeMockPool([makeDbRow('r1', 0.9)]);

      const results = await hybridSearch(pool, 'fire safety', {
        queryEmbedding: [0.1, 0.2, 0.3],
      });

      // Pool.query should have been called twice: once for vector, once for keyword
      expect(pool.query).toHaveBeenCalledTimes(2);
      const calls = pool.query.mock.calls;
      // One call should be the vector query (with embedding), the other the keyword query
      const sqlTexts = calls.map((c: unknown[]) => c[0] as string);
      expect(sqlTexts.some((s: string) => s.includes('<=>'))).toBe(true);
      expect(sqlTexts.some((s: string) => s.includes('plainto_tsquery'))).toBe(true);

      // Should return results (fused from both)
      expect(Array.isArray(results)).toBe(true);
    });

    it('respects vectorK and keywordK options', async () => {
      const pool = makeMockPool([]);

      await hybridSearch(pool, 'query', {
        vectorK: 20,
        keywordK: 15,
        queryEmbedding: [0.1],
      });

      const calls = pool.query.mock.calls;
      // vector call params last element should be vectorK
      const vectorCall = calls.find((c: unknown[]) => (c[0] as string).includes('<=>'));
      const keywordCall = calls.find((c: unknown[]) => (c[0] as string).includes('plainto_tsquery'));
      expect(vectorCall![1][vectorCall![1].length - 1]).toBe(20);
      expect(keywordCall![1][keywordCall![1].length - 1]).toBe(15);
    });

    it('respects topK option to limit final results', async () => {
      // Return many rows from DB so fusion has plenty to work with
      const manyRows = Array.from({ length: 10 }, (_, i) => makeDbRow(`r${i}`, 0.9 - i * 0.05));
      const pool = makeMockPool(manyRows);

      const results = await hybridSearch(pool, 'query', {
        topK: 3,
        queryEmbedding: [0.1],
      });

      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('passes filter through to both search functions', async () => {
      const pool = makeMockPool([]);

      await hybridSearch(pool, 'query', {
        filter: { department: 'FSD', documentType: 'ordinance' },
        queryEmbedding: [0.1],
      });

      // Both queries should contain the filter clauses
      for (const call of pool.query.mock.calls) {
        const sql = call[0] as string;
        const params = call[1] as unknown[];
        expect(sql).toContain('source_department = $');
        expect(sql).toContain('document_type = $');
        expect(params).toContain('FSD');
        expect(params).toContain('ordinance');
      }
    });

    it('returns empty array when both searches return nothing', async () => {
      const pool = makeMockPool([]);

      const results = await hybridSearch(pool, 'nonexistent query', {
        queryEmbedding: [0.1],
      });

      expect(results).toEqual([]);
    });

    it('uses default options when none provided', async () => {
      const pool = makeMockPool([]);

      await hybridSearch(pool, 'query', {
        queryEmbedding: [0.1],
      });

      const calls = pool.query.mock.calls;
      // Default vectorK = 15, keywordK = 15
      const vectorCall = calls.find((c: unknown[]) => (c[0] as string).includes('<=>'));
      const keywordCall = calls.find((c: unknown[]) => (c[0] as string).includes('plainto_tsquery'));
      expect(vectorCall![1][vectorCall![1].length - 1]).toBe(15);
      expect(keywordCall![1][keywordCall![1].length - 1]).toBe(15);
    });
  });
});
