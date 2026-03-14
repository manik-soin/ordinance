import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rerank } from '../../src/retrieval/reranker.js';
import type { SearchResult } from '../../src/retrieval/hybrid-search.js';

function makeResult(id: string, score: number): SearchResult {
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
    search_method: 'hybrid',
  };
}

describe('Reranker', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env.COHERE_API_KEY;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.COHERE_API_KEY = originalEnv;
  });

  it('gracefully degrades when no API key is set', async () => {
    delete process.env.COHERE_API_KEY;

    const results = [makeResult('a', 0.9), makeResult('b', 0.8)];
    const reranked = await rerank('test query', results);

    expect(reranked).toEqual(results);
  });

  it('reranks results using Cohere API response', async () => {
    process.env.COHERE_API_KEY = 'test-key';

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            { index: 1, relevance_score: 0.95 },
            { index: 0, relevance_score: 0.85 },
          ],
        }),
    });

    const results = [makeResult('a', 0.5), makeResult('b', 0.4)];
    const reranked = await rerank('test query', results, { apiKey: 'test-key' });

    expect(reranked[0].id).toBe('b'); // index 1 ranked first
    expect(reranked[0].score).toBe(0.95);
    expect(reranked[1].id).toBe('a');
  });

  it('filters out results below score threshold', async () => {
    process.env.COHERE_API_KEY = 'test-key';

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            { index: 0, relevance_score: 0.8 },
            { index: 1, relevance_score: 0.1 }, // below threshold
          ],
        }),
    });

    const results = [makeResult('a', 0.5), makeResult('b', 0.4)];
    const reranked = await rerank('test query', results, {
      apiKey: 'test-key',
      threshold: 0.3,
    });

    expect(reranked.length).toBe(1);
    expect(reranked[0].id).toBe('a');
  });

  it('falls back to original results on API error', async () => {
    process.env.COHERE_API_KEY = 'test-key';

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const results = [makeResult('a', 0.5)];
    const reranked = await rerank('test query', results, { apiKey: 'test-key' });

    expect(reranked).toEqual(results);
  });
});
