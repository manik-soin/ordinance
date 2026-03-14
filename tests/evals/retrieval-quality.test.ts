import { describe, it, expect } from 'vitest';
import { rrfFuse } from '../../src/retrieval/hybrid-search.js';
import type { SearchResult } from '../../src/retrieval/hybrid-search.js';

/**
 * Retrieval quality evaluation tests.
 * Validates that retrieval logic maintains quality invariants.
 */

function makeResult(
  id: string,
  score: number,
  method: 'vector' | 'keyword' = 'vector',
  dept = 'BD'
): SearchResult {
  return {
    id,
    content: `Content for ${id}`,
    score,
    source_department: dept,
    document_type: 'code_of_practice',
    document_name: `Document ${id}`,
    version: '2024',
    section_hierarchy: ['Section 1'],
    page_number: 1,
    cross_references: [],
    search_method: method,
  };
}

describe('Retrieval Quality Evaluation', () => {
  describe('RRF fusion quality invariants', () => {
    it('hybrid results always rank higher than single-source results', () => {
      // Create scenario where same docs appear in both
      const vectorResults = [
        makeResult('shared-1', 0.9),
        makeResult('shared-2', 0.8),
        makeResult('vector-only', 0.7),
      ];
      const keywordResults = [
        makeResult('shared-1', 5.0, 'keyword'),
        makeResult('shared-2', 4.0, 'keyword'),
        makeResult('keyword-only', 3.0, 'keyword'),
      ];

      const fused = rrfFuse(vectorResults, keywordResults, 10);

      // Shared results should be in top positions
      const sharedIdx1 = fused.findIndex((r) => r.id === 'shared-1');
      const sharedIdx2 = fused.findIndex((r) => r.id === 'shared-2');
      const vectorOnlyIdx = fused.findIndex((r) => r.id === 'vector-only');
      const keywordOnlyIdx = fused.findIndex((r) => r.id === 'keyword-only');

      expect(sharedIdx1).toBeLessThan(vectorOnlyIdx);
      expect(sharedIdx1).toBeLessThan(keywordOnlyIdx);
      expect(sharedIdx2).toBeLessThan(vectorOnlyIdx);
      expect(sharedIdx2).toBeLessThan(keywordOnlyIdx);
    });

    it('results are sorted by descending RRF score', () => {
      const vector = Array.from({ length: 5 }, (_, i) => makeResult(`v${i}`, 1 - i * 0.1));
      const keyword = Array.from({ length: 5 }, (_, i) => makeResult(`k${i}`, 5 - i, 'keyword'));

      const fused = rrfFuse(vector, keyword, 10);

      for (let i = 1; i < fused.length; i++) {
        expect(fused[i].score).toBeLessThanOrEqual(fused[i - 1].score);
      }
    });

    it('no duplicate results in fused output', () => {
      const vector = [makeResult('a', 0.9), makeResult('b', 0.8)];
      const keyword = [makeResult('a', 5.0, 'keyword'), makeResult('b', 4.0, 'keyword')];

      const fused = rrfFuse(vector, keyword, 10);
      const ids = fused.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('topK correctly limits output size', () => {
      const vector = Array.from({ length: 20 }, (_, i) => makeResult(`v${i}`, 1 - i * 0.01));
      const keyword = Array.from({ length: 20 }, (_, i) => makeResult(`k${i}`, 20 - i, 'keyword'));

      for (const k of [1, 3, 5, 10]) {
        const fused = rrfFuse(vector, keyword, k);
        expect(fused.length).toBeLessThanOrEqual(k);
      }
    });
  });

  describe('Department filtering quality', () => {
    it('mixed department results are properly handled by RRF', () => {
      const vector = [
        makeResult('bd-1', 0.9, 'vector', 'BD'),
        makeResult('fsd-1', 0.85, 'vector', 'FSD'),
        makeResult('epd-1', 0.8, 'vector', 'EPD'),
      ];
      const keyword = [
        makeResult('fsd-1', 5.0, 'keyword', 'FSD'),
        makeResult('bd-1', 4.0, 'keyword', 'BD'),
      ];

      const fused = rrfFuse(vector, keyword, 5);

      // FSD-1 and BD-1 appear in both → should rank highest
      expect(['bd-1', 'fsd-1']).toContain(fused[0].id);
      expect(['bd-1', 'fsd-1']).toContain(fused[1].id);
    });
  });

  describe('Edge case handling', () => {
    it('handles single result gracefully', () => {
      const fused = rrfFuse([makeResult('only', 0.9)], [], 5);
      expect(fused).toHaveLength(1);
      expect(fused[0].id).toBe('only');
    });

    it('handles empty input gracefully', () => {
      const fused = rrfFuse([], [], 5);
      expect(fused).toHaveLength(0);
    });

    it('handles topK = 0', () => {
      const fused = rrfFuse([makeResult('a', 0.9)], [], 0);
      expect(fused).toHaveLength(0);
    });
  });

  // These require a populated database
  describe.skipIf(!process.env.DATABASE_URL)('Live retrieval evaluation', () => {
    it.todo('achieves precision@3 > 82% on golden test set');
    it.todo('achieves recall@5 > 90% on golden test set');
    it.todo('hybrid search outperforms vector-only search');
    it.todo('hybrid search outperforms keyword-only search');
    it.todo('department filter correctly scopes results');
    it.todo('exact clause queries return correct document');
  });
});
