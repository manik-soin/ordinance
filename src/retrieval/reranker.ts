import type { SearchResult } from './hybrid-search.js';

const COHERE_RERANK_URL = 'https://api.cohere.com/v2/rerank';
const DEFAULT_MODEL = 'rerank-v3.5';
const DEFAULT_THRESHOLD = 0.01;

export interface RerankOptions {
  model?: string;
  topK?: number;
  threshold?: number;
  apiKey?: string;
}

interface CohereRerankResponse {
  results: Array<{
    index: number;
    relevance_score: number;
  }>;
}

/**
 * Rerank search results using Cohere Rerank API.
 */
export async function rerank(
  query: string,
  results: SearchResult[],
  options?: RerankOptions
): Promise<SearchResult[]> {
  const apiKey = options?.apiKey ?? process.env.COHERE_API_KEY;
  if (!apiKey) {
    // If no Cohere API key, return results as-is (graceful degradation)
    console.warn('COHERE_API_KEY not set, skipping reranking');
    return results;
  }

  const model = options?.model ?? DEFAULT_MODEL;
  const topK = options?.topK ?? 5;
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;

  const documents = results.map((r) => r.content);

  const response = await fetch(COHERE_RERANK_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      query,
      documents,
      top_n: topK,
      return_documents: false,
    }),
  });

  if (!response.ok) {
    console.error(`Cohere Rerank failed: HTTP ${response.status}`);
    return results; // graceful degradation
  }

  const data = (await response.json()) as CohereRerankResponse;

  return data.results
    .filter((r) => r.relevance_score >= threshold)
    .map((r) => ({
      ...results[r.index],
      score: r.relevance_score,
    }));
}
