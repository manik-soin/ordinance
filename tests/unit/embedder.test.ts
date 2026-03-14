import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EMBEDDING_MODEL, EMBEDDING_DIMS, embedTexts, embedQuery } from '../../src/embedder/index.js';

describe('Embedder', () => {
  describe('Configuration', () => {
    it('uses text-embedding-3-large model', () => {
      expect(EMBEDDING_MODEL).toBe('text-embedding-3-large');
    });

    it('uses 3072 dimensions', () => {
      expect(EMBEDDING_DIMS).toBe(3072);
    });
  });

  describe('embedChunks', () => {
    it('generates embeddings for each chunk', async () => {
      // Mock OpenAI client
      const mockCreate = vi.fn().mockResolvedValue({
        data: [
          { index: 0, embedding: new Array(3072).fill(0.1) },
          { index: 1, embedding: new Array(3072).fill(0.2) },
        ],
      });

      const mockClient = {
        embeddings: { create: mockCreate },
      } as any;

      const { embedChunks } = await import('../../src/embedder/index.js');

      const chunks = [
        {
          content: 'Test content 1',
          metadata: {
            source_department: 'BD',
            document_type: 'code_of_practice',
            document_name: 'Test',
            version: '2024',
            section_hierarchy: [],
            page_number: 1,
            is_current: true,
            cross_references: [],
            content_hash: 'hash1',
            ingested_at: new Date().toISOString(),
          },
        },
        {
          content: 'Test content 2',
          metadata: {
            source_department: 'BD',
            document_type: 'code_of_practice',
            document_name: 'Test',
            version: '2024',
            section_hierarchy: [],
            page_number: 2,
            is_current: true,
            cross_references: [],
            content_hash: 'hash2',
            ingested_at: new Date().toISOString(),
          },
        },
      ];

      const result = await embedChunks(chunks, { client: mockClient });

      expect(result).toHaveLength(2);
      expect(result[0].embedding).toHaveLength(3072);
      expect(result[1].embedding).toHaveLength(3072);
      expect(mockCreate).toHaveBeenCalledOnce();
    });

    it('batches chunks (max 100 per API call)', async () => {
      const mockCreate = vi.fn().mockImplementation(({ input }: { input: string[] }) => ({
        data: input.map((_: string, i: number) => ({
          index: i,
          embedding: new Array(3072).fill(0),
        })),
      }));

      const mockClient = {
        embeddings: { create: mockCreate },
      } as any;

      const { embedChunks } = await import('../../src/embedder/index.js');

      // Create 150 chunks to verify batching
      const chunks = Array.from({ length: 150 }, (_, i) => ({
        content: `Content ${i}`,
        metadata: {
          source_department: 'BD',
          document_type: 'code_of_practice' as const,
          document_name: 'Test',
          version: '2024',
          section_hierarchy: [],
          page_number: 1,
          is_current: true,
          cross_references: [],
          content_hash: `hash${i}`,
          ingested_at: new Date().toISOString(),
        },
      }));

      const result = await embedChunks(chunks, { client: mockClient });

      expect(result).toHaveLength(150);
      expect(mockCreate).toHaveBeenCalledTimes(2); // 100 + 50
    });
  });

  /* ------------------------------------------------------------------ */
  /*  embedTexts                                                         */
  /* ------------------------------------------------------------------ */
  describe('embedTexts', () => {
    it('returns embeddings for multiple texts', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        data: [
          { index: 0, embedding: [0.1, 0.2, 0.3] },
          { index: 1, embedding: [0.4, 0.5, 0.6] },
        ],
      });
      const mockClient = { embeddings: { create: mockCreate } } as any;

      const result = await embedTexts(['text one', 'text two'], { client: mockClient });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual([0.1, 0.2, 0.3]);
      expect(result[1]).toEqual([0.4, 0.5, 0.6]);
      expect(mockCreate).toHaveBeenCalledOnce();
      expect(mockCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-large',
        dimensions: 3072,
        input: ['text one', 'text two'],
      });
    });

    it('returns embeddings sorted by index even if API returns out of order', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        data: [
          { index: 1, embedding: [0.4, 0.5] },
          { index: 0, embedding: [0.1, 0.2] },
        ],
      });
      const mockClient = { embeddings: { create: mockCreate } } as any;

      const result = await embedTexts(['first', 'second'], { client: mockClient });

      expect(result[0]).toEqual([0.1, 0.2]);
      expect(result[1]).toEqual([0.4, 0.5]);
    });

    it('returns a single embedding for a single text', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
      });
      const mockClient = { embeddings: { create: mockCreate } } as any;

      const result = await embedTexts(['only one'], { client: mockClient });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual([0.1, 0.2, 0.3]);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  embedQuery                                                         */
  /* ------------------------------------------------------------------ */
  describe('embedQuery', () => {
    it('returns a single embedding vector for the query', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        data: [{ index: 0, embedding: [0.7, 0.8, 0.9] }],
      });
      const mockClient = { embeddings: { create: mockCreate } } as any;

      const result = await embedQuery('fire safety requirements', { client: mockClient });

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([0.7, 0.8, 0.9]);
      expect(mockCreate).toHaveBeenCalledOnce();
      expect(mockCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-large',
        dimensions: 3072,
        input: ['fire safety requirements'],
      });
    });

    it('passes the query as a single-element array to the API', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        data: [{ index: 0, embedding: [0.1] }],
      });
      const mockClient = { embeddings: { create: mockCreate } } as any;

      await embedQuery('test', { client: mockClient });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.input).toEqual(['test']);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Retry / backoff logic                                              */
  /* ------------------------------------------------------------------ */
  describe('retry logic', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('retries on failure and succeeds on second attempt', async () => {
      const mockCreate = vi.fn()
        .mockRejectedValueOnce(new Error('rate limited'))
        .mockResolvedValueOnce({
          data: [{ index: 0, embedding: [0.1, 0.2] }],
        });
      const mockClient = { embeddings: { create: mockCreate } } as any;

      // Use embedQuery which internally calls embedTextsWithRetry with maxRetries=3
      const promise = embedQuery('test query', { client: mockClient });

      // Advance timers to handle the exponential backoff sleep(1000 * 2^0 = 1000ms)
      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;

      expect(result).toEqual([0.1, 0.2]);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('retries multiple times with increasing backoff', async () => {
      const mockCreate = vi.fn()
        .mockRejectedValueOnce(new Error('error 1'))
        .mockRejectedValueOnce(new Error('error 2'))
        .mockResolvedValueOnce({
          data: [{ index: 0, embedding: [0.5] }],
        });
      const mockClient = { embeddings: { create: mockCreate } } as any;

      const promise = embedQuery('test', { client: mockClient });

      // First retry: sleep(1000 * 2^0) = 1000ms
      await vi.advanceTimersByTimeAsync(1000);
      // Second retry: sleep(1000 * 2^1) = 2000ms
      await vi.advanceTimersByTimeAsync(2000);

      const result = await promise;

      expect(result).toEqual([0.5]);
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });

    it('throws after exhausting all retries', async () => {
      const mockCreate = vi.fn().mockRejectedValue(new Error('persistent failure'));
      const mockClient = { embeddings: { create: mockCreate } } as any;

      const promise = embedQuery('test', { client: mockClient });

      // Advance through all backoff sleeps: 1000ms + 2000ms
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);

      await expect(promise).rejects.toThrow('persistent failure');
      expect(mockCreate).toHaveBeenCalledTimes(3); // maxRetries = 3
    });

    it('propagates the last error after all retries fail', async () => {
      const mockCreate = vi.fn()
        .mockRejectedValueOnce(new Error('first error'))
        .mockRejectedValueOnce(new Error('second error'))
        .mockRejectedValueOnce(new Error('third and final error'));
      const mockClient = { embeddings: { create: mockCreate } } as any;

      const promise = embedQuery('test', { client: mockClient });

      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);

      await expect(promise).rejects.toThrow('third and final error');
    });

    it('handles non-Error throw values gracefully', async () => {
      const mockCreate = vi.fn().mockRejectedValue('string error');
      const mockClient = { embeddings: { create: mockCreate } } as any;

      const promise = embedQuery('test', { client: mockClient });

      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);

      await expect(promise).rejects.toThrow('string error');
    });

    afterEach(() => {
      vi.useRealTimers();
    });
  });

  /* ------------------------------------------------------------------ */
  /*  embedChunks retry integration                                      */
  /* ------------------------------------------------------------------ */
  describe('embedChunks with retry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('retries failed batch and succeeds', async () => {
      const mockCreate = vi.fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce({
          data: [{ index: 0, embedding: [0.1] }],
        });
      const mockClient = { embeddings: { create: mockCreate } } as any;

      const { embedChunks } = await import('../../src/embedder/index.js');

      const chunks = [{
        content: 'test',
        metadata: {
          source_department: 'BD',
          document_type: 'code_of_practice' as const,
          document_name: 'Test',
          version: '2024',
          section_hierarchy: [],
          page_number: 1,
          is_current: true,
          cross_references: [],
          content_hash: 'hash',
          ingested_at: new Date().toISOString(),
        },
      }];

      const promise = embedChunks(chunks, { client: mockClient, maxRetries: 3 });

      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;
      expect(result).toHaveLength(1);
      expect(result[0].embedding).toEqual([0.1]);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    afterEach(() => {
      vi.useRealTimers();
    });
  });
});
