import { z } from 'zod';
import type OpenAI from 'openai';
import type pg from 'pg';
import type { AgentStep } from './types.js';
import type { AgentTool } from './tools.js';
import { toOpenAITools, executeTool } from './tools.js';
import type { Scratchpad } from './scratchpad.js';

/**
 * The Thought-Action-Observation loop (ReAct). The model reasons about what
 * it needs, picks a tool, observes the result, and decides whether it is done
 * or needs another step.
 *
 * Key harness property: the working context is REBUILT each step —
 * system prompt + a fresh render of the external scratchpad — instead of an
 * ever-growing chat transcript. Observations persist in the scratchpad, full
 * chunks in its store. That is the anti-context-rot design from the harness
 * writeup, not an optimization detail.
 */

export const SPAWN_TOOL_NAME = 'spawn_subagents';

const spawnArgsSchema = z.object({
  tasks: z
    .array(z.string().min(10).max(300))
    .min(2)
    .max(3)
    .describe('Self-contained research objectives (max 300 chars each), one per subagent'),
});

function spawnToolSpec(): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: SPAWN_TOOL_NAME,
      description:
        'Fan out 2-3 INDEPENDENT research tasks to parallel subagents, each with a clean context and the retrieve/resolve_reference tools. Use ONLY when the question decomposes into lookups that do not depend on each other (e.g. comparing requirements across occupancies). Each task must be a self-contained objective. Do NOT use it for sequential work.',
      parameters: z.toJSONSchema(spawnArgsSchema) as Record<string, unknown>,
    },
  };
}

const MAX_TOOL_CALLS_PER_STEP = 3;

export interface LoopConfig {
  client: OpenAI;
  pool: pg.Pool;
  scratchpad: Scratchpad;
  tools: AgentTool[];
  model: string;
  stepBudget: number;
  systemPrompt: string;
  /** Renders the full working context for a step (scratchpad view + budget). */
  buildUserContext: (stepsUsed: number) => string;
  /** Only set for models that accept it (gpt-5-mini rejects temperature). */
  temperature?: number;
  maxCompletionTokens?: number;
  /** When provided, the spawn_subagents capability is surfaced to the model. */
  onSpawnSubagents?: (tasks: string[]) => Promise<string>;
  /** Continue numbering steps across exit-gate retries. */
  startStep?: number;
}

export interface LoopOutcome {
  finalText: string | null;
  steps: AgentStep[];
  promptTokens: number;
  completionTokens: number;
  budgetExhausted: boolean;
  subagentRuns: number;
}

/**
 * Run the loop until the model produces a final answer or the step budget is
 * exhausted (in which case one last no-tools call forces a best-effort answer).
 */
export async function runToolLoop(config: LoopConfig): Promise<LoopOutcome> {
  const steps: AgentStep[] = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let subagentRuns = 0;
  let stepsUsed = 0;
  const startStep = config.startStep ?? 0;

  const toolSpecs = toOpenAITools(config.tools);
  if (config.onSpawnSubagents) toolSpecs.push(spawnToolSpec());

  const toolContext = { pool: config.pool, scratchpad: config.scratchpad };

  while (stepsUsed < config.stepBudget) {
    const stepNumber = startStep + stepsUsed + 1;
    const stepStart = Date.now();

    const response = await config.client.chat.completions.create({
      model: config.model,
      messages: [
        { role: 'system', content: config.systemPrompt },
        { role: 'user', content: config.buildUserContext(stepsUsed) },
      ],
      tools: toolSpecs,
      tool_choice: 'auto',
      max_completion_tokens: config.maxCompletionTokens ?? 1200,
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    });

    promptTokens += response.usage?.prompt_tokens ?? 0;
    completionTokens += response.usage?.completion_tokens ?? 0;

    const message = response.choices[0]?.message;
    const toolCalls = (message?.tool_calls ?? []).filter(
      (tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
        tc.type === 'function'
    );

    if (toolCalls.length > 0) {
      const thought = message?.content?.trim() || undefined;

      for (const toolCall of toolCalls.slice(0, MAX_TOOL_CALLS_PER_STEP)) {
        const name = toolCall.function.name;
        let args: unknown;
        try {
          args = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          const observation = `TOOL ERROR (${name}): arguments were not valid JSON. Retry with valid arguments.`;
          config.scratchpad.addObservation(stepNumber, name, observation);
          steps.push({
            step: stepNumber,
            thought,
            tool: name,
            args: undefined,
            observation,
            promptTokens: response.usage?.prompt_tokens ?? 0,
            completionTokens: response.usage?.completion_tokens ?? 0,
            durationMs: Date.now() - stepStart,
          });
          continue;
        }

        let observation: string;
        if (name === SPAWN_TOOL_NAME && config.onSpawnSubagents) {
          const parsed = spawnArgsSchema.safeParse(args);
          if (!parsed.success) {
            observation = `TOOL ERROR (${SPAWN_TOOL_NAME}): ${parsed.error.issues[0]?.message}. Provide 2-3 self-contained task strings.`;
          } else {
            try {
              observation = await config.onSpawnSubagents(parsed.data.tasks);
              subagentRuns += parsed.data.tasks.length;
            } catch (err) {
              console.error(`[agent] ${SPAWN_TOOL_NAME} failed:`, err instanceof Error ? err.message : String(err));
              observation = `TOOL ERROR (${SPAWN_TOOL_NAME}): subagent fan-out failed. Research the tasks yourself with retrieve.`;
            }
          }
        } else {
          const result = await executeTool(config.tools, name, args, toolContext);
          observation = result.observation;
        }

        config.scratchpad.addObservation(stepNumber, name, observation);
        steps.push({
          step: stepNumber,
          thought,
          tool: name,
          args: args as Record<string, unknown>,
          observation,
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
          durationMs: Date.now() - stepStart,
        });
      }

      if (toolCalls.length > MAX_TOOL_CALLS_PER_STEP) {
        config.scratchpad.addObservation(
          stepNumber,
          'harness',
          `Only the first ${MAX_TOOL_CALLS_PER_STEP} tool calls of ${toolCalls.length} were executed. Prefer one tool call per step.`
        );
      }

      stepsUsed++;
      continue;
    }

    const content = message?.content?.trim();
    if (content) {
      return {
        finalText: content,
        steps,
        promptTokens,
        completionTokens,
        budgetExhausted: false,
        subagentRuns,
      };
    }

    // Neither a tool call nor an answer — nudge and burn a step so a confused
    // model cannot loop forever.
    config.scratchpad.addObservation(
      stepNumber,
      'harness',
      'Empty response. Either call a tool or write your final answer.'
    );
    stepsUsed++;
  }

  // Budget exhausted: force a best-effort final answer with tools disabled.
  const finalResponse = await config.client.chat.completions.create({
    model: config.model,
    messages: [
      { role: 'system', content: config.systemPrompt },
      {
        role: 'user',
        content: `${config.buildUserContext(stepsUsed)}\n\nYour step budget is exhausted. Write your final answer NOW from the observations above. If the observations are insufficient, say what is missing rather than fabricating.`,
      },
    ],
    max_completion_tokens: config.maxCompletionTokens ?? 1200,
    ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
  });

  promptTokens += finalResponse.usage?.prompt_tokens ?? 0;
  completionTokens += finalResponse.usage?.completion_tokens ?? 0;

  return {
    finalText: finalResponse.choices[0]?.message?.content?.trim() ?? null,
    steps,
    promptTokens,
    completionTokens,
    budgetExhausted: true,
    subagentRuns,
  };
}
