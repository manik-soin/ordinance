import type { SearchResult } from '../retrieval/hybrid-search.js';
import type { Citation } from '../generator/index.js';
import type { VerificationResult } from '../safety/citation-verifier.js';
import type { FaithfulnessResult } from '../safety/faithfulness.js';
import type { QueryCost } from '../observability/cost-tracker.js';

/**
 * Durable structured project memory. Pinned into the working context each
 * step instead of replaying raw chat history.
 */
export interface ProjectMemory {
  buildingType?: string;
  storeys?: number;
  useClass?: string;
  siteAreaSqm?: number;
  notes?: string[];
}

/** Which execution path the complexity router chose. */
export type QueryPath = 'static' | 'agent';

export interface RouteDecision {
  path: QueryPath;
  reasons: string[];
  /** Populated when a comparison query fans out into independent lookups. */
  fanOutTasks?: string[];
}

/** One Thought-Action-Observation step recorded in the trace. */
export interface AgentStep {
  step: number;
  thought?: string;
  tool?: string;
  args?: Record<string, unknown>;
  observation: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}

export interface AgentTrace {
  steps: AgentStep[];
  stepBudget: number;
  budgetExhausted: boolean;
  verificationRetries: number;
  subagentRuns: number;
}

export interface AgentQueryResult {
  answer: string;
  citations: Citation[];
  sources: SearchResult[];
  verification: VerificationResult;
  faithfulness: FaithfulnessResult;
  auditId: string;
  latencyMs: number;
  model: string;
  path: QueryPath;
  routeReasons: string[];
  trace?: AgentTrace;
  projectMemory: ProjectMemory;
  cached?: boolean;
  webSources?: Array<{ title: string; url: string; source: string }>;
  cost?: QueryCost;
}
