import OpenAI from 'openai';
import type { Chunk } from '../chunker/index.js';

export interface EmbeddedChunk extends Chunk {
  embedding: number[];
}

const BATCH_SIZE = 100;
const EMBEDDING_MODEL = 'text-embedding-3-large';
const EMBEDDING_DIMS = 3072;

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI();
  }
  return _client;
}

/**
 * Generate embeddings for a batch of chunks.
 */
export async function embedChunks(
  chunks: Chunk[],
  options?: { client?: OpenAI; maxRetries?: number }
): Promise<EmbeddedChunk[]> {
  const client = options?.client ?? getClient();
  const maxRetries = options?.maxRetries ?? 3;
  const results: EmbeddedChunk[] = [];

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map((c) => c.content);

    const embeddings = await embedTextsWithRetry(client, texts, maxRetries);

    for (let j = 0; j < batch.length; j++) {
      results.push({
        ...batch[j],
        embedding: embeddings[j],
      });
    }
  }

  return results;
}

/**
 * Generate embeddings for raw text strings.
 */
export async function embedTexts(
  texts: string[],
  options?: { client?: OpenAI }
): Promise<number[][]> {
  const client = options?.client ?? getClient();
  return embedTextsWithRetry(client, texts, 3);
}

/**
 * Embed a single query string.
 */
export async function embedQuery(
  query: string,
  options?: { client?: OpenAI }
): Promise<number[]> {
  const client = options?.client ?? getClient();
  const [embedding] = await embedTextsWithRetry(client, [query], 3);
  return embedding;
}

async function embedTextsWithRetry(
  client: OpenAI,
  texts: string[],
  maxRetries: number
): Promise<number[][]> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.embeddings.create({
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMS,
        input: texts,
      });

      return response.data
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        await sleep(1000 * Math.pow(2, attempt - 1)); // exponential backoff
      }
    }
  }

  throw lastError ?? new Error('Embedding failed');
}

export { EMBEDDING_MODEL, EMBEDDING_DIMS };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
