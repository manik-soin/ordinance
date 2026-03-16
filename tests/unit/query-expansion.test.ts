import { describe, it, expect, vi } from 'vitest';
import { expandQuery } from '../../src/retrieval/query-expansion.js';

function createMockClient(content: string | null) {
  const mockCreate = vi.fn().mockResolvedValue({
    choices: [{ message: { content } }],
  });
  return {
    client: { chat: { completions: { create: mockCreate } } } as any,
    mockCreate,
  };
}

describe('expandQuery', () => {
  it('returns original query as first element', async () => {
    const { client } = createMockClient('expansion 1\nexpansion 2\nexpansion 3');
    const result = await expandQuery('fire safety requirements', { client });
    expect(result[0]).toBe('fire safety requirements');
  });

  it('returns expanded queries from LLM response', async () => {
    const { client } = createMockClient('expansion 1\nexpansion 2\nexpansion 3');
    const result = await expandQuery('fire safety requirements', { client });
    expect(result).toEqual([
      'fire safety requirements',
      'expansion 1',
      'expansion 2',
      'expansion 3',
    ]);
  });

  it('handles empty LLM response (returns just original)', async () => {
    const { client } = createMockClient('');
    const result = await expandQuery('fire safety requirements', { client });
    expect(result).toEqual(['fire safety requirements']);
  });

  it('handles null LLM response (returns just original)', async () => {
    const { client } = createMockClient(null);
    const result = await expandQuery('fire safety requirements', { client });
    expect(result).toEqual(['fire safety requirements']);
  });

  it('handles LLM response with blank lines (filters them out)', async () => {
    const { client } = createMockClient('expansion 1\n\n\nexpansion 2\n  \nexpansion 3\n');
    const result = await expandQuery('fire safety requirements', { client });
    expect(result).toEqual([
      'fire safety requirements',
      'expansion 1',
      'expansion 2',
      'expansion 3',
    ]);
  });

  it('uses gpt-5-mini model', async () => {
    const { client, mockCreate } = createMockClient('expansion 1');
    await expandQuery('test query', { client });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5-mini',
      })
    );
  });

  it('uses temperature 0.3', async () => {
    const { client, mockCreate } = createMockClient('expansion 1');
    await expandQuery('test query', { client });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.3,
      })
    );
  });

  it('passes query as user message', async () => {
    const { client, mockCreate } = createMockClient('expansion 1');
    await expandQuery('what are the fire escape requirements', { client });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: 'what are the fire escape requirements',
          }),
        ]),
      })
    );
  });

  it('system prompt mentions Hong Kong regulations', async () => {
    const { client, mockCreate } = createMockClient('expansion 1');
    await expandQuery('test query', { client });

    const callArgs = mockCreate.mock.calls[0][0];
    const systemMessage = callArgs.messages.find(
      (m: any) => m.role === 'system'
    );
    expect(systemMessage).toBeDefined();
    expect(systemMessage.content).toContain('Hong Kong');
    expect(systemMessage.content).toMatch(/regulat/i);
  });
});
