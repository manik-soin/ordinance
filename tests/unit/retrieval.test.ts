import { describe, it, expect } from 'vitest';
import { rrfFuse } from '../../src/retrieval/hybrid-search.js';
import type { SearchResult } from '../../src/retrieval/hybrid-search.js';

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
  });
});
