import type OpenAI from 'openai';
import type pg from 'pg';
import type { SearchResult } from '../retrieval/hybrid-search.js';
import { Scratchpad } from './scratchpad.js';
import { SUBAGENT_TOOLS } from './tools.js';
import { runToolLoop } from './loop.js';
import { SUBAGENT_SYSTEM_PROMPT, budgetLine } from './prompts.js';

/**
 * Subagents for parallel cross-document work. Each gets its own clean
 * context and only the lookup tools (retrieve, resolve_reference), returns a
 * compact cited summary, and hands its retrieved chunks back so the lead's
 * exit gate can verify citations — the lead's PROMPT never sees raw chunks,
 * only the distilled findings.
 *
 * Subagents run on gpt-5-mini: focused retrieve-and-summarize work does not
 * need the frontier model (match model intelligence to task complexity).
 */

const SUBAGENT_MODEL = 'gpt-5-mini';
const SUBAGENT_STEP_BUDGET = 3;

export interface SubagentResult {
  objective: string;
  summary: string;
  stepsTaken: number;
  chunks: SearchResult[];
  promptTokens: number;
  completionTokens: number;
}

/** Run one subagent to completion on a single research objective. */
export async function runSubagent(options: {
  client: OpenAI;
  pool: pg.Pool;
  objective: string;
  model?: string;
  stepBudget?: number;
}): Promise<SubagentResult> {
  const scratchpad = new Scratchpad(options.objective);
  const stepBudget = options.stepBudget ?? SUBAGENT_STEP_BUDGET;

  const outcome = await runToolLoop({
    client: options.client,
    pool: options.pool,
    scratchpad,
    tools: SUBAGENT_TOOLS,
    model: options.model ?? SUBAGENT_MODEL,
    stepBudget,
    systemPrompt: SUBAGENT_SYSTEM_PROMPT,
    buildUserContext: (stepsUsed) =>
      `${scratchpad.renderForPrompt()}\n\n${budgetLine(stepsUsed, stepBudget)}`,
    maxCompletionTokens: 700,
  });

  return {
    objective: options.objective,
    summary: outcome.finalText ?? 'Subagent produced no summary.',
    stepsTaken: outcome.steps.length,
    chunks: scratchpad.getAllChunks(),
    promptTokens: outcome.promptTokens,
    completionTokens: outcome.completionTokens,
  };
}

export interface FanOutResult {
  observation: string;
  chunks: SearchResult[];
  promptTokens: number;
  completionTokens: number;
}

/**
 * Run subagents for independent tasks in parallel and merge their findings
 * into a single observation for the lead agent.
 */
export async function runSubagentsParallel(options: {
  client: OpenAI;
  pool: pg.Pool;
  tasks: string[];
  model?: string;
}): Promise<FanOutResult> {
  const settled = await Promise.allSettled(
    options.tasks.map((objective) =>
      runSubagent({
        client: options.client,
        pool: options.pool,
        objective,
        model: options.model,
      })
    )
  );

  const chunks: SearchResult[] = [];
  const sections: string[] = [];
  let promptTokens = 0;
  let completionTokens = 0;

  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      sections.push(`[subagent ${i + 1}: ${result.value.objective}]\n${result.value.summary}`);
      chunks.push(...result.value.chunks);
      promptTokens += result.value.promptTokens;
      completionTokens += result.value.completionTokens;
    } else {
      sections.push(
        `[subagent ${i + 1}: ${options.tasks[i]}] FAILED: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
      );
    }
  });

  return {
    observation: `Subagent findings (cited summaries — their source chunks are in the store for verification):\n\n${sections.join('\n\n')}`,
    chunks,
    promptTokens,
    completionTokens,
  };
}
