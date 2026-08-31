import type pg from 'pg';
import { hybridSearch } from '../retrieval/hybrid-search.js';
import { expandQuery, generateHyDE } from '../retrieval/query-expansion.js';
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
import { routeQuery } from '../retrieval/query-router.js';
import { expandCrossReferences } from '../retrieval/cross-ref-expander.js';
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
  useHyDE?: boolean;
  useCRAG?: boolean;
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

  // 0a. Query routing — auto-detect regulatory domain and apply filter
  const routedFilter = routeQuery(resolvedQuery);
  const mergedFilter: SearchFilter | undefined = options?.filter ?? routedFilter;

  // 0. Exact-match cache avoids any model call on repeated queries.
  const exactCached = await checkExactCache(
    pool,
    resolvedQuery,
    options?.filter
  ).catch(() => null);
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

  // 2. Run query expansion + primary search + HyDE + live web search in parallel
  const useHyDE = options?.useHyDE ?? true;
  const [primaryResults, expandedQueries, hydeDoc, webSearch] = await Promise.all([
    hybridSearch(pool, resolvedQuery, {
      filter: mergedFilter,
      topK: topK * 2,
      queryEmbedding,
    }),
    useExpansion ? expandQuery(resolvedQuery) : Promise.resolve([resolvedQuery]),
    useHyDE ? generateHyDE(resolvedQuery).catch(() => '') : Promise.resolve(''),
    liveWebSearch(resolvedQuery),
  ]);

  // 3. Search with expanded queries and HyDE document, then fuse all results
  let allResults: SearchResult[];
  const extraQueries = expandedQueries.filter((q) => q !== resolvedQuery);
  const hydeQueries = hydeDoc.length > 20 ? [hydeDoc] : [];
  const allExtraQueries = [...extraQueries, ...hydeQueries];

  if (allExtraQueries.length > 0) {
    const extraResults = await Promise.all(
      allExtraQueries.map((q) =>
        hybridSearch(pool, q, { filter: mergedFilter, topK: topK })
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

  // 4a. Cross-reference expansion — follow refs to related regulatory chunks
  reranked = await expandCrossReferences(pool, reranked, { maxExpansion: 2 });

  // 4b. CRAG — Corrective RAG: when retrieval confidence is very low, strip
  //     the retrieved context entirely and let the model answer from parametric
  //     knowledge. Benchmarks show misleading context hurts more than no context.
  const useCRAG = options?.useCRAG ?? false; // Off by default — benchmarks show it hurts MCQ accuracy
  let generationContext = reranked;
  if (useCRAG) {
    const retrievalConfidence = assessRetrievalConfidence(reranked);
    if (!retrievalConfidence.confident) {
      generationContext = [];
    }
  }

  // 5. Generate answer with citations
  const generation = await generateAnswer(resolvedQuery, generationContext, {
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
  writeCache(
    pool,
    resolvedQuery,
    finalAnswer,
    generation.citations,
    reranked,
    options?.filter,
    {
      queryEmbedding,
    }
  ).catch(() => {});

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
    webSources: webSearch.webResults.map((w) => ({
      title: w.title,
      url: w.url,
      source: w.source,
    })),
    cost,
  };
}

/**
 * CRAG: Assess retrieval confidence based on reranker scores and result diversity.
 * Low confidence triggers a cautionary note to the generator.
 */
function assessRetrievalConfidence(results: SearchResult[]): {
  confident: boolean;
  topScore: number;
  avgScore: number;
} {
  if (results.length === 0) {
    return { confident: false, topScore: 0, avgScore: 0 };
  }

  const topScore = results[0].score;
  const avgScore = results.reduce((s, r) => s + r.score, 0) / results.length;

  // Thresholds tuned for Cohere rerank-v3.5 (scores 0-1) and
  // RRF scores (much smaller, ~0.01-0.03).
  // If top score is very low, context is likely irrelevant.
  const isCohere = topScore > 0.1; // Cohere scores are typically 0.1-0.99
  const threshold = isCohere ? 0.15 : 0.005;

  return {
    confident: topScore >= threshold && results.length >= 2,
    topScore,
    avgScore,
  };
}
