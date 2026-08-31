import type { ProjectMemory, RouteDecision } from './types.js';
import { extractProjectMemory, hasMemory } from './memory.js';

/**
 * Complexity router: decides whether a query goes to the one-shot RAG
 * pipeline (single-hop lookups — the default) or into the agent loop
 * (multi-hop, freshness-sensitive, or context-dependent queries).
 *
 * Deliberately a keyword heuristic, not an LLM call: routing runs in
 * microseconds and costs no tokens. The agent is the exception path,
 * not the default.
 */

const FRESHNESS_PATTERNS = [
  /\bstill\s+(approved|valid|current|accepted|on\s+the\s+list)\b/i,
  /\bapproved\s+list\b/i,
  /\baccepted\s+list\b/i,
  /\blatest\s+(list|version|circular|pnap|data)\b/i,
  /\bas\s+of\s+(today|now|20\d\d)\b/i,
  /\bcurrently\s+(approved|accepted|listed|valid)\b/i,
  /\bup[-\s]to[-\s]date\b/i,
  /\bnew\s+(circular|pnap|amendment)s?\b/i,
];

/** Live datasets exist for these product families (data.gov.hk BD open data). */
const LIVE_DATASET_TERMS = /\b(fire\s*door(set)?s?|fire\s*(rated\s*)?glazing|fire\s*stop|firestop|mic\b|modular\s+integrated)\b/i;
const APPROVAL_TERMS = /\b(approved|accepted|listed|rating|manufacturer|model|test\s+report)\b/i;

const COMPARISON_PATTERNS = [
  /\bcompare\b/i,
  /\bcomparison\b/i,
  /\bversus\b/i,
  /\bvs\.?\b/i,
  /\bdifference(s)?\s+between\b/i,
  /\bacross\b/i,
];

const OCCUPANCY_TERMS = [
  'residential',
  'domestic',
  'commercial',
  'industrial',
  'composite',
  'office',
  'hotel',
  'institutional',
] as const;

const CROSS_REF_INTENT = /\b(subject\s+to|refer(?:s|red)?\s+to|points?\s+to|cross[-\s]refer|the\s+clause\s+it|what\s+does\s+(that|the|this)\s+(part|section|clause))\b/i;
const CROSS_REF_TARGET = /\b(part|section|clause|schedule|cap\.?|pnap)\s*[IVX\d]/i;

const DEICTIC_PROJECT = /\b(my|this|our)\s+(building|project|development|site|tower|block)\b/i;

/**
 * Classify a query as single-hop (static RAG) or agent-worthy.
 * Returns the reasons so the decision is auditable in the trace.
 */
export function routeComplexity(
  query: string,
  options?: { memory?: ProjectMemory; historyLength?: number }
): RouteDecision {
  const reasons: string[] = [];

  // 1. Freshness — does the answer depend on live government data?
  const freshnessHit =
    FRESHNESS_PATTERNS.some((p) => p.test(query)) ||
    (LIVE_DATASET_TERMS.test(query) && APPROVAL_TERMS.test(query));
  if (freshnessHit) reasons.push('freshness');

  // 2. Multi-hop comparison — independent lookups that fan out.
  const comparisonHit = COMPARISON_PATTERNS.some((p) => p.test(query));
  const occupanciesFound = OCCUPANCY_TERMS.filter((t) =>
    new RegExp(`\\b${t}\\b`, 'i').test(query)
  );
  let fanOutTasks: string[] | undefined;
  if (comparisonHit && occupanciesFound.length >= 2) {
    reasons.push('multi-hop-comparison');
    // Cap at 3 to match the spawn_subagents schema (min 2, max 3).
    fanOutTasks = occupanciesFound.slice(0, 3).map((o) => `${o} occupancy`);
  } else if (comparisonHit && occupanciesFound.length > 0) {
    reasons.push('multi-hop-comparison');
  }

  // 3. Cross-reference chasing — the second hop static RAG can't make.
  if (CROSS_REF_INTENT.test(query) && CROSS_REF_TARGET.test(query)) {
    reasons.push('cross-reference');
  }

  // 4. Context-dependent — the query leans on pinned project facts.
  const extracted = extractProjectMemory(query);
  const extractedFacts = Object.values(extracted).filter((v) => v !== undefined).length;
  if (extractedFacts >= 2) {
    reasons.push('context-dependent');
  } else if (hasMemory(options?.memory) && DEICTIC_PROJECT.test(query)) {
    reasons.push('context-dependent');
  }

  if (reasons.length === 0) {
    return { path: 'static', reasons: ['single-hop'] };
  }

  return { path: 'agent', reasons, fanOutTasks };
}
