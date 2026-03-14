import { describe, it, expect, vi } from 'vitest';
import { EMBEDDING_MODEL, EMBEDDING_DIMS } from '../../src/embedder/index.js';

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
});
