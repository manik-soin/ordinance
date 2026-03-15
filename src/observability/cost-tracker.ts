/**
 * Token usage and cost tracking for the query pipeline.
 * Based on enterprise RAG patterns (fwd project learnings).
 *
 * Tracks per-query costs across all OpenAI API calls
 * and provides aggregate statistics.
 */

// Pricing per 1M tokens (as of March 2026)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'text-embedding-3-large': { input: 0.13, output: 0 },
};

export interface QueryCost {
  model: string;
  promptTokens: number;
  completionTokens: number;
  embeddingTokens: number;
  totalTokens: number;
  costUsd: number;
  breakdown: {
    expansion: number;
    embedding: number;
    generation: number;
    faithfulness: number;
  };
}

export interface AggregateStats {
  totalQueries: number;
  totalCostUsd: number;
  averageCostUsd: number;
  totalTokens: number;
  cacheHits: number;
  cacheHitRate: number;
  since: string;
}

// In-memory tracking (resets on server restart)
let stats = {
  totalQueries: 0,
  totalCostUsd: 0,
  totalTokens: 0,
  cacheHits: 0,
  startedAt: new Date().toISOString(),
};

/**
 * Calculate cost for a set of token usages.
 */
function calcCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING['gpt-4o-mini'];
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

/**
 * Estimate the cost of a full query pipeline execution.
 */
export function estimateQueryCost(options: {
  generationModel?: string;
  promptTokens?: number;
  completionTokens?: number;
  cached?: boolean;
}): QueryCost {
  const model = options.generationModel ?? 'gpt-4o';
  const cached = options.cached ?? false;

  if (cached) {
    // Cache hit: only embedding cost
    const embCost = calcCost('text-embedding-3-large', 50, 0);
    stats.totalQueries++;
    stats.cacheHits++;
    stats.totalCostUsd += embCost;
    stats.totalTokens += 50;

    return {
      model: 'cached',
      promptTokens: 0,
      completionTokens: 0,
      embeddingTokens: 50,
      totalTokens: 50,
      costUsd: embCost,
      breakdown: { expansion: 0, embedding: embCost, generation: 0, faithfulness: 0 },
    };
  }

  // Estimates for each pipeline stage
  const expansionIn = 200;
  const expansionOut = 100;
  const embeddingTokens = 50; // query embedding
  const genIn = options.promptTokens ?? 4000;
  const genOut = options.completionTokens ?? 500;
  const faithIn = 3000;
  const faithOut = 200;

  const expansionCost = calcCost('gpt-4o-mini', expansionIn, expansionOut);
  const embeddingCost = calcCost('text-embedding-3-large', embeddingTokens, 0);
  const generationCost = calcCost(model, genIn, genOut);
  const faithfulnessCost = calcCost('gpt-4o-mini', faithIn, faithOut);
  const totalCost = expansionCost + embeddingCost + generationCost + faithfulnessCost;

  const totalTokens = expansionIn + expansionOut + embeddingTokens + genIn + genOut + faithIn + faithOut;

  stats.totalQueries++;
  stats.totalCostUsd += totalCost;
  stats.totalTokens += totalTokens;

  return {
    model,
    promptTokens: genIn,
    completionTokens: genOut,
    embeddingTokens,
    totalTokens,
    costUsd: totalCost,
    breakdown: {
      expansion: expansionCost,
      embedding: embeddingCost,
      generation: generationCost,
      faithfulness: faithfulnessCost,
    },
  };
}

/**
 * Get aggregate cost statistics since server start.
 */
export function getAggregateStats(): AggregateStats {
  return {
    totalQueries: stats.totalQueries,
    totalCostUsd: Math.round(stats.totalCostUsd * 10000) / 10000,
    averageCostUsd: stats.totalQueries > 0
      ? Math.round((stats.totalCostUsd / stats.totalQueries) * 10000) / 10000
      : 0,
    totalTokens: stats.totalTokens,
    cacheHits: stats.cacheHits,
    cacheHitRate: stats.totalQueries > 0
      ? Math.round((stats.cacheHits / stats.totalQueries) * 100) / 100
      : 0,
    since: stats.startedAt,
  };
}

/**
 * Reset statistics (for testing).
 */
export function resetStats(): void {
  stats = {
    totalQueries: 0,
    totalCostUsd: 0,
    totalTokens: 0,
    cacheHits: 0,
    startedAt: new Date().toISOString(),
  };
}
