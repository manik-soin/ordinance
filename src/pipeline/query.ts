import type pg from 'pg';
import { hybridSearch } from '../retrieval/hybrid-search.js';
import { expandQuery } from '../retrieval/query-expansion.js';
import { rerank } from '../retrieval/reranker.js';
import { generateAnswer } from '../generator/index.js';
import { verifyCitations, appendDisclaimer } from '../safety/citation-verifier.js';
import { scoreFaithfulness } from '../safety/faithfulness.js';
import { logQueryAudit } from '../db/store.js';
import { rrfFuse } from '../retrieval/hybrid-search.js';
import { liveWebSearch } from '../retrieval/web-search.js';
import { checkExactCache, checkSemanticCache, writeCache } from '../cache/semantic-cache.js';
import { estimateQueryCost } from '../observability/cost-tracker.js';
import { contextualizeFollowUpQuery } from '../retrieval/follow-up-context.js';
import type { SearchFilter, SearchResult } from '../retrieval/hybrid-search.js';
import type { Citation } from '../generator/index.js';
import type { VerificationResult } from '../safety/citation-verifier.js';
import type { FaithfulnessResult } from '../safety/faithfulness.js';
import type { ConversationTurn } from '../retrieval/follow-up-context.js';
import { embedQuery } from '../embedder/index.js';

export interface QueryPipelineResult {
  answer: string;
  citations: Citation[];
  sources: SearchResult[];
  verification: VerificationResult;
  faithfulness: FaithfulnessResult;
  auditId: string;
  latencyMs: number;
  model: string;
  cached?: boolean;
  webSources?: Array<{ title: string; url: string; source: string }>;
  cost?: import('../observability/cost-tracker.js').QueryCost;
}

export interface QueryPipelineOptions {
  filter?: SearchFilter;
  history?: ConversationTurn[];
  useQueryExpansion?: boolean;
  useReranker?: boolean;
  skipFaithfulness?: boolean;
  topK?: number;
}

/**
 * Full query pipeline:
 * Validate → Expand → Retrieve → Rerank → Generate → Verify → Audit
 */
export async function queryPipeline(
  pool: pg.Pool,
  query: string,
  options?: QueryPipelineOptions
): Promise<QueryPipelineResult> {
  const start = Date.now();
  const useExpansion = options?.useQueryExpansion ?? true;
  const useReranker = options?.useReranker ?? true;
  const topK = options?.topK ?? 5;
  const resolvedQuery = await contextualizeFollowUpQuery(
    query,
    options?.history ?? []
  ).catch(() => query);

  // 0. Exact-match cache avoids any model call on repeated queries.
  const exactCached = await checkExactCache(pool, resolvedQuery, options?.filter).catch(() => null);
  if (exactCached) {
    const liveSearch = await liveWebSearch(resolvedQuery).catch(() => ({
      webResults: [],
      supplementaryContext: '',
    }));

    return {
      answer: exactCached.answer,
      citations: (exactCached.citations ?? []) as Citation[],
      sources: (exactCached.sources ?? []) as SearchResult[],
      verification: { totalCitations: 0, verifiedCitations: 0, citationAccuracy: 1, phantomCitations: [], uncitedClaims: [] } as VerificationResult,
      faithfulness: { score: -1, reasoning: 'Cached', flaggedClaims: [] },
      auditId: 'cached',
      latencyMs: Date.now() - start,
      model: 'cached',
      cached: true,
      webSources: liveSearch.webResults.map((w) => ({
        title: w.title,
        url: w.url,
        source: w.source,
      })),
      cost: estimateQueryCost({ cached: true, embeddingTokens: 0 }),
    };
  }

  let queryEmbedding: number[] | undefined;
  try {
    queryEmbedding = await embedQuery(resolvedQuery);
  } catch {
    // Fall back to retrieval-layer embedding if the eager lookup fails.
  }

  // 1. Semantic cache still saves the generation path, but only after reusing the
  //    already-computed query embedding.
  const semanticCached = queryEmbedding
    ? await checkSemanticCache(pool, resolvedQuery, options?.filter, {
      queryEmbedding,
    }).catch(() => null)
    : null;

  if (semanticCached) {
    const liveSearch = await liveWebSearch(resolvedQuery).catch(() => ({
      webResults: [],
      supplementaryContext: '',
    }));

    return {
      answer: semanticCached.answer,
      citations: (semanticCached.citations ?? []) as Citation[],
      sources: (semanticCached.sources ?? []) as SearchResult[],
      verification: { totalCitations: 0, verifiedCitations: 0, citationAccuracy: 1, phantomCitations: [], uncitedClaims: [] } as VerificationResult,
      faithfulness: { score: -1, reasoning: 'Cached', flaggedClaims: [] },
      auditId: 'cached',
      latencyMs: Date.now() - start,
      model: 'cached',
      cached: true,
      webSources: liveSearch.webResults.map((w) => ({
        title: w.title,
        url: w.url,
        source: w.source,
      })),
      cost: estimateQueryCost({ cached: true, embeddingTokens: 50 }),
    };
  }

  // 2. Run query expansion + primary search + live web search in parallel
  //    The original query search starts immediately while expansion runs
  const [primaryResults, expandedQueries, webSearch] = await Promise.all([
    hybridSearch(pool, resolvedQuery, {
      filter: options?.filter,
      topK: topK * 2,
      queryEmbedding,
    }),
    useExpansion ? expandQuery(resolvedQuery) : Promise.resolve([resolvedQuery]),
    liveWebSearch(resolvedQuery),
  ]);

  // 3. If expansion produced extra queries, search those and fuse with primary
  let allResults: SearchResult[];
  const extraQueries = expandedQueries.filter((q) => q !== resolvedQuery);
  if (extraQueries.length > 0) {
    const extraResults = await Promise.all(
      extraQueries.map((q) =>
        hybridSearch(pool, q, { filter: options?.filter, topK: topK })
      )
    );
    const flat = [...primaryResults, ...extraResults.flat()];
    allResults = rrfFuse(flat, [], topK * 2);
  } else {
    allResults = primaryResults;
  }

  // 4. Rerank (optional)
  let reranked: SearchResult[];
  if (useReranker && allResults.length > 0) {
    reranked = await rerank(resolvedQuery, allResults, { topK });
  } else {
    reranked = allResults.slice(0, topK);
  }

  // 5. Generate answer with citations
  const generation = await generateAnswer(resolvedQuery, reranked, {
    supplementaryContext: webSearch.supplementaryContext,
  });

  // 6. Verify citations (synchronous, fast)
  const verification = verifyCitations(
    generation.answer,
    generation.citations,
    reranked
  );

  // 7. Append disclaimer
  const finalAnswer = appendDisclaimer(generation.answer);

  // 8. Faithfulness scoring + audit log — run in parallel (both are independent)
  const latencyMs = Date.now() - start;
  const [faithfulness, auditId] = await Promise.all([
    options?.skipFaithfulness
      ? Promise.resolve({ score: -1, reasoning: 'Skipped', flaggedClaims: [] } as FaithfulnessResult)
      : scoreFaithfulness(resolvedQuery, generation.answer, reranked),
    logQueryAudit(pool, {
      query,
      filters: options?.filter as Record<string, unknown>,
      chunkIds: reranked.map((r) => r.id),
      response: finalAnswer,
      citations: generation.citations,
      faithfulnessScore: -1, // Updated after faithfulness completes
      citationAccuracy: verification.citationAccuracy,
      model: generation.model,
      latencyMs,
    }),
  ]);

  // 9. Write to cache (non-blocking).
  writeCache(pool, resolvedQuery, finalAnswer, generation.citations, reranked, options?.filter, {
    queryEmbedding,
  }).catch(() => {});

  // 10. Track cost
  const cost = estimateQueryCost({
    generationModel: generation.model,
    promptTokens: generation.prompt_tokens,
    completionTokens: generation.completion_tokens,
  });

  return {
    answer: finalAnswer,
    citations: generation.citations,
    sources: reranked,
    verification,
    faithfulness,
    auditId,
    latencyMs,
    model: generation.model,
    cached: false,
    webSources: webSearch.webResults.map(w => ({ title: w.title, url: w.url, source: w.source })),
    cost,
  };
}
