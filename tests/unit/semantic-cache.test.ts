import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/embedder/index.js', () => ({
  embedQuery: vi.fn(),
}));

import {
  checkExactCache,
  checkSemanticCache,
  writeCache,
} from '../../src/cache/semantic-cache.js';
import { embedQuery } from '../../src/embedder/index.js';

describe('semantic cache', () => {
  const mockPool = {
    query: vi.fn(),
  } as unknown as import('pg').Pool;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns exact cache hits without creating an embedding', async () => {
    vi.mocked(mockPool.query).mockResolvedValueOnce({
      rows: [
        {
          query: 'What is the fire resistance rating?',
          answer: '2 hours.',
          citations: [],
          sources: [],
          cached_at: '2026-03-15T00:00:00.000Z',
        },
      ],
    } as never);

    const result = await checkExactCache(
      mockPool,
      '  WHAT   is the\nfire resistance rating?  ',
      { department: 'BD' }
    );

    expect(embedQuery).not.toHaveBeenCalled();
    expect(result?.answer).toBe('2 hours.');
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('normalized_query = $1'),
      [
        'what is the fire resistance rating?',
        JSON.stringify({
          department: 'BD',
          documentType: null,
          capNumber: null,
          isCurrent: null,
        }),
        3600,
      ]
    );
  });

  it('reuses a precomputed embedding for semantic lookup', async () => {
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rows: [] } as never);

    await checkSemanticCache(
      mockPool,
      'test query',
      { department: 'FSD' },
      { queryEmbedding: [0.1, 0.2, 0.3] }
    );

    expect(embedQuery).not.toHaveBeenCalled();
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('query_embedding <=> $1::vector'),
      [
        '[0.1,0.2,0.3]',
        0.95,
        JSON.stringify({
          department: 'FSD',
          documentType: null,
          capNumber: null,
          isCurrent: null,
        }),
        3600,
      ]
    );
  });

  it('updates cache entries with a precomputed embedding before inserting', async () => {
    vi.mocked(mockPool.query).mockResolvedValueOnce({ rowCount: 1 } as never);

    await writeCache(
      mockPool,
      'Fire door requirement',
      'Use an approved doorset.',
      [{ id: 'citation-1' }],
      [{ id: 'source-1' }],
      { department: 'BD' },
      { queryEmbedding: [0.9, 0.1] }
    );

    expect(embedQuery).not.toHaveBeenCalled();
    expect(mockPool.query).toHaveBeenCalledTimes(1);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE query_cache'),
      [
        'Fire door requirement',
        '[0.9,0.1]',
        'Use an approved doorset.',
        JSON.stringify([{ id: 'citation-1' }]),
        JSON.stringify([{ id: 'source-1' }]),
        'BD',
        'fire door requirement',
        JSON.stringify({
          department: 'BD',
          documentType: null,
          capNumber: null,
          isCurrent: null,
        }),
      ]
    );
  });
});
