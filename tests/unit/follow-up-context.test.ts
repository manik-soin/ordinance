import { describe, it, expect, vi } from 'vitest';
import {
  contextualizeFollowUpQuery,
  type ConversationTurn,
} from '../../src/retrieval/follow-up-context.js';

function makeMockClient(answer: string) {
  const mockCreate = vi.fn().mockResolvedValue({
    choices: [{ message: { content: answer } }],
  });
  return {
    client: { chat: { completions: { create: mockCreate } } } as any,
    mockCreate,
  };
}

describe('contextualizeFollowUpQuery', () => {
  it('returns the original query when there is no history', async () => {
    const result = await contextualizeFollowUpQuery('What about residential buildings?', [], {
      client: { chat: { completions: { create: vi.fn() } } } as any,
    });

    expect(result).toBe('What about residential buildings?');
  });

  it('rewrites a follow-up question using prior context', async () => {
    const history: ConversationTurn[] = [
      { role: 'user', content: 'What are the fire resistance requirements for stair enclosures?' },
      { role: 'assistant', content: 'The requirements depend on the building type.' },
    ];
    const { client, mockCreate } = makeMockClient(
      'What are the fire resistance requirements for stair enclosures in residential buildings?'
    );

    const result = await contextualizeFollowUpQuery('What about residential buildings?', history, {
      client,
    });

    expect(result).toContain('stair enclosures');
    expect(result).toContain('residential buildings');

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages[1].content).toContain('Conversation history');
    expect(callArgs.messages[1].content).toContain('What about residential buildings?');
  });

  it('falls back to the original query when the model returns empty content', async () => {
    const history: ConversationTurn[] = [{ role: 'user', content: 'Tell me about ramps.' }];
    const { client } = makeMockClient('');

    const result = await contextualizeFollowUpQuery('And widths?', history, { client });
    expect(result).toBe('And widths?');
  });
});
