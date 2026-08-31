import OpenAI from 'openai';
import type pg from 'pg';
import { queryPipeline } from '../pipeline/query.js';
import { appendDisclaimer } from '../safety/citation-verifier.js';
import { scoreFaithfulness } from '../safety/faithfulness.js';
import { logQueryAudit } from '../db/store.js';
import { estimateQueryCost } from '../observability/cost-tracker.js';
import { MODEL_PRICING } from '../observability/cost-tracker.js';
import { contextualizeFollowUpQuery } from '../retrieval/follow-up-context.js';
import type { ConversationTurn } from '../retrieval/follow-up-context.js';
import type { SearchFilter, SearchResult } from '../retrieval/hybrid-search.js';
import type { FaithfulnessResult } from '../safety/faithfulness.js';
import { routeComplexity } from './complexity-router.js';
import { extractProjectMemory, mergeProjectMemory, hasMemory, renderMemory } from './memory.js';
import { Scratchpad } from './scratchpad.js';
import { AGENT_TOOLS } from './tools.js';
import { runToolLoop, SPAWN_TOOL_NAME } from './loop.js';
import { runSubagentsParallel } from './subagents.js';
import { verifyAgentCitations } from './citation-gate.js';
import { AGENT_SYSTEM_PROMPT, budgetLine } from './prompts.js';
import type { AgentQueryResult, AgentStep, ProjectMemory, RouteDecision } from './types.js';

export { routeComplexity } from './complexity-router.js';
export type { AgentQueryResult, ProjectMemory, RouteDecision } from './types.js';

const AGENT_MODEL = 'gpt-5.4';
const SUBAGENT_MODEL = 'gpt-5-mini';
const DEFAULT_STEP_BUDGET = 6;
const EXIT_GATE_RETRY_BUDGET = 2;
const FAITHFULNESS_GATE = 6;
const MAX_SOURCES_RETURNED = 10;
const MAX_FAITHFULNESS_CHUNKS = 12;
// Hard per-request subagent budget. Bounds cost amplification: without it,
// spawn_subagents could fire up to 3x per step across every step + retry.
const MAX_SUBAGENTS_PER_REQUEST = 3;

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) _client = new OpenAI();
  return _client;
}

export interface AgentQueryOptions {
  filter?: SearchFilter;
  history?: ConversationTurn[];
  projectMemory?: ProjectMemory;
  /** 'auto' (router decides, default) | 'static' | 'agent' (force a path). */
  mode?: 'auto' | 'static' | 'agent';
  stepBudget?: number;
  skipFaithfulness?: boolean;
  /** Injection point for tests. */
  client?: OpenAI;
}

/** Seed the scratchpad plan from what the router detected. */
function initialTodos(route: RouteDecision): string[] {
  const todos: string[] = ['Retrieve the relevant regulation text'];
  if (route.reasons.includes('freshness')) {
    todos.push('Check live approval/current status via gov_lookup');
  }
  if (route.reasons.includes('cross-reference')) {
    todos.push('Resolve the cross-reference to the exact clause it points to');
  }
  if (route.fanOutTasks?.length) {
    todos.push(
      `Fan out subagents for independent lookups: ${route.fanOutTasks.join(', ')}`
    );
  }
  if (route.reasons.includes('context-dependent')) {
    todos.push('Apply the pinned project facts to the requirements');
  }
  todos.push('Finalize a concise answer with verified citations');
  return todos;
}

/**
 * Agentic Ordinance entry point.
 *
 * A lightweight complexity router decides the path: single-hop queries go
 * straight to the one-shot RAG pipeline (faster, cheaper, just as correct);
 * multi-hop, freshness-sensitive, or context-dependent queries enter the
 * agent loop. The agent is the exception path, not the default.
 */
export async function agentQuery(
  pool: pg.Pool,
  query: string,
  options?: AgentQueryOptions
): Promise<AgentQueryResult> {
  const start = Date.now();
  const client = options?.client ?? getClient();

  // Durable project memory: pin structured facts, don't replay chat history.
  const projectMemory = mergeProjectMemory(
    options?.projectMemory,
    extractProjectMemory(query)
  );

  const route = routeComplexity(query, {
    memory: projectMemory,
    historyLength: options?.history?.length,
  });
  const mode = options?.mode ?? 'auto';
  const path = mode === 'auto' ? route.path : mode;
  const routeReasons = mode === 'auto' ? route.reasons : [`forced-${mode}`];

  // ── Static path: the existing one-shot pipeline ──────────────────────────
  if (path === 'static') {
    const result = await queryPipeline(pool, query, {
      filter: options?.filter,
      history: options?.history,
      skipFaithfulness: options?.skipFaithfulness,
    });
    return {
      ...result,
      path: 'static',
      routeReasons,
      projectMemory,
    };
  }

  // ── Agent path ────────────────────────────────────────────────────────────
  const resolvedQuery =
    options?.history?.length
      ? await contextualizeFollowUpQuery(query, options.history, { client }).catch(() => query)
      : query;

  const stepBudget = options?.stepBudget ?? DEFAULT_STEP_BUDGET;
  const scratchpad = new Scratchpad(resolvedQuery);
  scratchpad.setTodos(initialTodos(route));

  let subagentPromptTokens = 0;
  let subagentCompletionTokens = 0;
  let totalSubagentRuns = 0;

  // Progressive disclosure of capability: fan-out is only surfaced when the
  // router saw a comparison shape.
  const onSpawnSubagents = route.reasons.includes('multi-hop-comparison')
    ? async (tasks: string[]): Promise<string> => {
        // Hard per-request subagent budget: spawn_subagents can be surfaced on
        // every step + retry, so cap total subagents to bound cost amplification.
        const remaining = MAX_SUBAGENTS_PER_REQUEST - totalSubagentRuns;
        if (remaining <= 0) {
          return `Subagent budget exhausted (${MAX_SUBAGENTS_PER_REQUEST} max per request). Research the remaining tasks yourself with retrieve, or synthesize from findings so far.`;
        }
        const allowed = tasks.slice(0, remaining);
        const fanOut = await runSubagentsParallel({ client, pool, tasks: allowed });
        // Subagent chunks feed the exit-gate verification store; the lead's
        // prompt only ever sees the distilled summaries.
        scratchpad.addChunks(fanOut.chunks);
        subagentPromptTokens += fanOut.promptTokens;
        subagentCompletionTokens += fanOut.completionTokens;
        totalSubagentRuns += allowed.length;
        const note =
          allowed.length < tasks.length
            ? `\n\n(Only ${allowed.length} of ${tasks.length} subagents ran — per-request budget reached.)`
            : '';
        return fanOut.observation + note;
      }
    : undefined;

  const memoryBlock = hasMemory(projectMemory) ? `${renderMemory(projectMemory)}\n\n` : '';
  const makeLoopConfig = (budget: number, startStep: number) => ({
    client,
    pool,
    scratchpad,
    tools: AGENT_TOOLS,
    model: AGENT_MODEL,
    stepBudget: budget,
    startStep,
    systemPrompt: AGENT_SYSTEM_PROMPT,
    buildUserContext: (stepsUsed: number) =>
      `${memoryBlock}${scratchpad.renderForPrompt()}\n\n${budgetLine(startStep + stepsUsed, startStep + budget)}`,
    temperature: 0.1,
    onSpawnSubagents,
  });

  // The faithfulness judge must see ALL evidence the agent acted on — the
  // chunk store plus live-data and subagent observations. Judging against
  // chunks alone would score grounded gov_lookup claims as unsupported.
  // Select the highest-scoring chunks (most likely to be what the answer
  // cites), not the earliest-retrieved, so late refined retrievals aren't lost.
  const judgeEvidence = (): SearchResult[] => [
    ...[...scratchpad.getAllChunks()]
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_FAITHFULNESS_CHUNKS),
    ...scratchpad
      .getObservations()
      .filter((o) => o.tool === 'gov_lookup' || o.tool === SPAWN_TOOL_NAME)
      .map((o, i) => ({
        id: `obs-${o.step}-${i}`,
        content: o.summary,
        score: 1,
        source_department: 'LIVE',
        document_type: 'live_data',
        document_name:
          o.tool === 'gov_lookup' ? 'Live data.gov.hk lookup result' : 'Subagent findings',
        version: 'live',
        section_hierarchy: [],
        page_number: 0,
        cross_references: [],
        search_method: 'keyword' as const,
      })),
  ];

  // First pass through the loop.
  let outcome = await runToolLoop(makeLoopConfig(stepBudget, 0));
  const allSteps: AgentStep[] = [...outcome.steps];
  let budgetExhausted = outcome.budgetExhausted;
  let promptTokens = outcome.promptTokens;
  let completionTokens = outcome.completionTokens;

  let answer = outcome.finalText ?? '';

  // ── Exit gate: verification is mandatory, not optional ───────────────────
  // The agent can take any path to the answer, but it can't skip the part
  // that makes the answer trustworthy. One corrective retry is allowed.
  let verificationRetries = 0;
  let chunks = scratchpad.getAllChunks();
  // Strict agent-side verification (flags fabricated documents AND fabricated
  // section numbers, which the shared verifier cannot).
  let gate = verifyAgentCitations(answer, chunks);
  let verification = gate.verification;
  let citations = gate.citations;
  let faithfulness: FaithfulnessResult = options?.skipFaithfulness
    ? { score: -1, reasoning: 'Skipped', flaggedClaims: [] }
    : await scoreFaithfulness(resolvedQuery, answer, judgeEvidence(), { client }).catch(
        () => ({ score: -1, reasoning: 'Faithfulness scoring failed', flaggedClaims: [] })
      );

  const gateFailed = (): boolean =>
    answer.length > 0 &&
    (verification.phantomCitations.length > 0 ||
      (faithfulness.score >= 0 && faithfulness.score < FAITHFULNESS_GATE));

  if (gateFailed()) {
    verificationRetries = 1;
    const problems: string[] = [];
    if (verification.phantomCitations.length > 0) {
      problems.push(
        `phantom citations with no supporting retrieved text: ${verification.phantomCitations
          .map((c) => `[${c.document_name}, ${c.section}]`)
          .join('; ')}`
      );
    }
    if (faithfulness.score >= 0 && faithfulness.score < FAITHFULNESS_GATE) {
      problems.push(
        `faithfulness ${faithfulness.score}/10 — flagged: ${faithfulness.flaggedClaims.slice(0, 3).join('; ')}`
      );
    }
    const lastStep = allSteps.reduce((max, step) => Math.max(max, step.step), 0);
    scratchpad.addObservation(
      lastStep + 1,
      'exit_gate',
      `EXIT GATE FAILED on your previous final answer: ${problems.join(' | ')}. Your previous answer draft:\n"""${answer.slice(0, 1500)}"""\nRevise it: remove or re-ground exactly the flagged citations/claims (retrieve supporting text first if needed), then give the corrected final answer.`
    );

    outcome = await runToolLoop(makeLoopConfig(EXIT_GATE_RETRY_BUDGET, lastStep + 1));
    allSteps.push(...outcome.steps);
    budgetExhausted = budgetExhausted || outcome.budgetExhausted;
    promptTokens += outcome.promptTokens;
    completionTokens += outcome.completionTokens;
    if (outcome.finalText) answer = outcome.finalText;

    chunks = scratchpad.getAllChunks();
    gate = verifyAgentCitations(answer, chunks);
    verification = gate.verification;
    citations = gate.citations;
    if (!options?.skipFaithfulness) {
      // On a rescore failure, don't attach the previous draft's failing
      // verdict to the corrected answer — use the honest -1 sentinel.
      faithfulness = await scoreFaithfulness(resolvedQuery, answer, judgeEvidence(), {
        client,
      }).catch(() => ({
        score: -1,
        reasoning: 'Faithfulness rescoring failed after retry',
        flaggedClaims: [],
      }));
    }
  }

  if (!answer) {
    answer =
      'I was unable to produce a grounded answer within the step budget. Please rephrase the question or narrow it to a specific regulation.';
  }

  const finalAnswer = appendDisclaimer(answer);
  const latencyMs = Date.now() - start;

  const sources = [...chunks]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SOURCES_RETURNED);

  const auditId = await logQueryAudit(pool, {
    query,
    filters: { path: 'agent', reasons: routeReasons } as Record<string, unknown>,
    chunkIds: sources.map((s) => s.id),
    response: finalAnswer,
    citations,
    faithfulnessScore: faithfulness.score,
    citationAccuracy: verification.citationAccuracy,
    model: `${AGENT_MODEL}+agent`,
    latencyMs,
  }).catch(() => 'audit-failed');

  // No cache write on the agent path: agent answers often depend on live
  // data or session memory, so a cached copy could serve a stale answer.
  // Lead tokens are priced at gpt-5.4; subagent tokens run on gpt-5-mini and
  // must not be folded into the gpt-5.4 bucket (that overstated them ~6-9x).
  const cost = estimateQueryCost({
    generationModel: AGENT_MODEL,
    promptTokens,
    completionTokens,
  });
  if (subagentPromptTokens > 0 || subagentCompletionTokens > 0) {
    const mini = MODEL_PRICING[SUBAGENT_MODEL];
    const subagentCost =
      (subagentPromptTokens * mini.input + subagentCompletionTokens * mini.output) / 1_000_000;
    cost.costUsd += subagentCost;
    cost.breakdown.generation += subagentCost;
    cost.completionTokens += subagentCompletionTokens;
    cost.promptTokens += subagentPromptTokens;
    cost.totalTokens += subagentPromptTokens + subagentCompletionTokens;
  }

  return {
    answer: finalAnswer,
    citations,
    sources,
    verification,
    faithfulness,
    auditId,
    latencyMs,
    model: `${AGENT_MODEL}+agent`,
    path: 'agent',
    routeReasons,
    trace: {
      steps: allSteps,
      stepBudget,
      budgetExhausted,
      verificationRetries,
      subagentRuns: totalSubagentRuns,
    },
    projectMemory,
    cached: false,
    cost,
  };
}
