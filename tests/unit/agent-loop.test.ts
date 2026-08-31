import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import type OpenAI from 'openai';
import type pg from 'pg';
import { runToolLoop } from '../../src/agent/loop.js';
import { Scratchpad } from '../../src/agent/scratchpad.js';
import type { AgentTool } from '../../src/agent/tools.js';

function toolCallResponse(name: string, args: unknown, thought?: string) {
  return {
    choices: [
      {
        message: {
          content: thought ?? null,
          tool_calls: [
            {
              id: 'tc-1',
              type: 'function',
              function: {
                name,
                arguments: typeof args === 'string' ? args : JSON.stringify(args),
              },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
  };
}

function finalResponse(text: string) {
  return {
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 80, completion_tokens: 40 },
  };
}

function makeClient() {
  const create = vi.fn();
  const client = { chat: { completions: { create } } } as unknown as OpenAI;
  return { client, create };
}

const stubExecute = vi.fn(async () => 'stub observation');
const stubTool: AgentTool = {
  name: 'retrieve',
  description: 'stub retrieve',
  schema: z.object({ query: z.string() }),
  execute: stubExecute,
};

const pool = { query: vi.fn() } as unknown as pg.Pool;

function makeConfig(overrides: Partial<Parameters<typeof runToolLoop>[0]> = {}) {
  const scratchpad = new Scratchpad('test question');
  return {
    scratchpad,
    config: {
      client: makeClient().client,
      pool,
      scratchpad,
      tools: [stubTool],
      model: 'gpt-5.4',
      stepBudget: 4,
      systemPrompt: 'system',
      buildUserContext: () => scratchpad.renderForPrompt(),
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runToolLoop', () => {
  it('executes tools, rebuilds context each step, then returns the final answer', async () => {
    const { client, create } = makeClient();
    create
      .mockResolvedValueOnce(toolCallResponse('retrieve', { query: 'fire resistance' }, 'I need the regulation text.'))
      .mockResolvedValueOnce(finalResponse('FINAL ANSWER [Doc]'));

    const { config, scratchpad } = makeConfig({ client });
    const outcome = await runToolLoop(config);

    expect(outcome.finalText).toBe('FINAL ANSWER [Doc]');
    expect(outcome.budgetExhausted).toBe(false);
    expect(outcome.steps).toHaveLength(1);
    expect(outcome.steps[0].tool).toBe('retrieve');
    expect(outcome.steps[0].thought).toBe('I need the regulation text.');
    expect(outcome.promptTokens).toBe(180);
    expect(outcome.completionTokens).toBe(60);
    expect(stubExecute).toHaveBeenCalledTimes(1);

    // The second call's working context is rebuilt from the scratchpad and
    // carries the first step's observation.
    const secondCallMessages = create.mock.calls[1][0].messages;
    expect(secondCallMessages).toHaveLength(2);
    expect(secondCallMessages[1].content).toContain('stub observation');
    expect(scratchpad.getObservations()[0].summary).toBe('stub observation');
  });

  it('forces a best-effort final answer with tools disabled when the budget runs out', async () => {
    const { client, create } = makeClient();
    create
      .mockResolvedValueOnce(toolCallResponse('retrieve', { query: 'a' }))
      .mockResolvedValueOnce(toolCallResponse('retrieve', { query: 'b' }))
      .mockResolvedValueOnce(finalResponse('BEST EFFORT'));

    const { config } = makeConfig({ client, stepBudget: 2 });
    const outcome = await runToolLoop(config);

    expect(create).toHaveBeenCalledTimes(3);
    expect(outcome.budgetExhausted).toBe(true);
    expect(outcome.finalText).toBe('BEST EFFORT');
    // The forced call must not offer tools.
    const forcedCall = create.mock.calls[2][0];
    expect(forcedCall.tools).toBeUndefined();
    expect(forcedCall.messages[1].content).toContain('budget is exhausted');
  });

  it('feeds invalid tool-call JSON back as a recoverable observation', async () => {
    const { client, create } = makeClient();
    create
      .mockResolvedValueOnce(toolCallResponse('retrieve', '{not json'))
      .mockResolvedValueOnce(finalResponse('done'));

    const { config, scratchpad } = makeConfig({ client });
    const outcome = await runToolLoop(config);

    expect(outcome.finalText).toBe('done');
    expect(scratchpad.getObservations()[0].summary).toContain('not valid JSON');
    expect(stubExecute).not.toHaveBeenCalled();
  });

  it('nudges the model when it returns neither a tool call nor an answer', async () => {
    const { client, create } = makeClient();
    create
      .mockResolvedValueOnce({ choices: [{ message: { content: '' } }], usage: { prompt_tokens: 10, completion_tokens: 0 } })
      .mockResolvedValueOnce(finalResponse('done'));

    const { config, scratchpad } = makeConfig({ client });
    const outcome = await runToolLoop(config);

    expect(outcome.finalText).toBe('done');
    expect(scratchpad.getObservations()[0].tool).toBe('harness');
    expect(scratchpad.getObservations()[0].summary).toContain('Either call a tool');
  });

  it('surfaces spawn_subagents only when a handler is provided, and runs it', async () => {
    const { client, create } = makeClient();
    const onSpawnSubagents = vi.fn(async () => 'subagent findings text');
    const tasks = [
      'research residential occupancy escape requirements',
      'research commercial occupancy escape requirements',
    ];
    create
      .mockResolvedValueOnce(toolCallResponse('spawn_subagents', { tasks }))
      .mockResolvedValueOnce(finalResponse('synthesized'));

    const { config, scratchpad } = makeConfig({ client, onSpawnSubagents });
    const outcome = await runToolLoop(config);

    expect(onSpawnSubagents).toHaveBeenCalledWith(tasks);
    expect(outcome.subagentRuns).toBe(2);
    expect(scratchpad.getObservations()[0].summary).toContain('subagent findings text');

    const offeredTools = create.mock.calls[0][0].tools.map(
      (t: { function: { name: string } }) => t.function.name
    );
    expect(offeredTools).toContain('spawn_subagents');
    expect(offeredTools).toContain('retrieve');
  });

  it('does not offer spawn_subagents without a handler', async () => {
    const { client, create } = makeClient();
    create.mockResolvedValueOnce(finalResponse('done'));

    const { config } = makeConfig({ client });
    await runToolLoop(config);

    const offeredTools = create.mock.calls[0][0].tools.map(
      (t: { function: { name: string } }) => t.function.name
    );
    expect(offeredTools).not.toContain('spawn_subagents');
  });
});
