import type pg from 'pg';
import { hybridSearch } from '../retrieval/hybrid-search.js';
import { expandQuery } from '../retrieval/query-expansion.js';
import { rerank } from '../retrieval/reranker.js';
import { generateAnswer } from '../generator/index.js';
import { verifyCitations, appendDisclaimer } from '../safety/citation-verifier.js';
import { scoreFaithfulness } from '../safety/faithfulness.js';
import { logQueryAudit } from '../db/store.js';
import { rrfFuse } from '../retrieval/hybrid-search.js';
import type { SearchFilter, SearchResult } from '../retrieval/hybrid-search.js';
import type { Citation } from '../generator/index.js';
import type { VerificationResult } from '../safety/citation-verifier.js';
import type { FaithfulnessResult } from '../safety/faithfulness.js';

export interface QueryPipelineResult {
  answer: string;
  citations: Citation[];
  sources: SearchResult[];
  verification: VerificationResult;
  faithfulness: FaithfulnessResult;
  auditId: string;
  latencyMs: number;
  model: string;
}

export interface QueryPipelineOptions {
  filter?: SearchFilter;
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

  // 1. Query expansion (optional)
  let queries: string[];
  if (useExpansion) {
    queries = await expandQuery(query);
  } else {
    queries = [query];
  }

  // 2. Hybrid retrieval (run for each expanded query, then fuse)
  let allResults: SearchResult[] = [];
  if (queries.length === 1) {
    allResults = await hybridSearch(pool, queries[0], {
      filter: options?.filter,
      topK: topK * 2,
    });
  } else {
    const perQueryResults = await Promise.all(
      queries.map((q) =>
        hybridSearch(pool, q, {
          filter: options?.filter,
          topK: topK,
        })
      )
    );
    // Merge all results with RRF
    const flat = perQueryResults.flat();
    allResults = rrfFuse(flat, [], topK * 2);
  }

  // 3. Rerank (optional)
  let reranked: SearchResult[];
  if (useReranker && allResults.length > 0) {
    reranked = await rerank(query, allResults, { topK });
  } else {
    reranked = allResults.slice(0, topK);
  }

  // 4. Generate answer with citations
  const generation = await generateAnswer(query, reranked);

  // 5. Verify citations
  const verification = verifyCitations(
    generation.answer,
    generation.citations,
    reranked
  );

  // 6. Score faithfulness (optional, runs in parallel with response)
  let faithfulness: FaithfulnessResult;
  if (!options?.skipFaithfulness) {
    faithfulness = await scoreFaithfulness(query, generation.answer, reranked);
  } else {
    faithfulness = { score: -1, reasoning: 'Skipped', flaggedClaims: [] };
  }

  // 7. Append disclaimer
  const finalAnswer = appendDisclaimer(generation.answer);

  // 8. Audit log
  const latencyMs = Date.now() - start;
  const auditId = await logQueryAudit(pool, {
    query,
    filters: options?.filter as Record<string, unknown>,
    chunkIds: reranked.map((r) => r.id),
    response: finalAnswer,
    citations: generation.citations,
    faithfulnessScore: faithfulness.score,
    citationAccuracy: verification.citationAccuracy,
    model: generation.model,
    latencyMs,
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
  };
}
