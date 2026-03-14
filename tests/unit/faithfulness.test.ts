import { describe, it, expect, vi } from 'vitest';
import { scoreFaithfulness } from '../../src/safety/faithfulness.js';
import type { SearchResult } from '../../src/retrieval/hybrid-search.js';

function makeContext(name: string, content: string): SearchResult {
  return {
    id: 'test-id',
    content,
    score: 0.9,
    source_department: 'BD',
    document_type: 'code_of_practice',
    document_name: name,
    version: '2024',
    section_hierarchy: ['Section 1'],
    page_number: 1,
    cross_references: [],
    search_method: 'hybrid',
  };
}

describe('Faithfulness Scorer', () => {
  it('returns score from LLM judge', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              score: 8,
              reasoning: 'Answer is well-supported by source text',
              flagged_claims: [],
            }),
          },
        },
      ],
    });

    const mockClient = {
      chat: { completions: { create: mockCreate } },
    } as any;

    const context = [makeContext('Fire Safety Code', 'Fire resistance period is 120 minutes for structural elements.')];

    const result = await scoreFaithfulness(
      'What is the fire resistance period?',
      'The fire resistance period is 120 minutes [Fire Safety Code, Section 1].',
      context,
      { client: mockClient }
    );

    expect(result.score).toBe(8);
    expect(result.reasoning).toContain('well-supported');
    expect(result.flaggedClaims).toEqual([]);
  });

  it('returns flagged claims when answer has unsupported content', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              score: 4,
              reasoning: 'Contains fabricated requirements',
              flagged_claims: ['The building must be painted blue every 5 years'],
            }),
          },
        },
      ],
    });

    const mockClient = {
      chat: { completions: { create: mockCreate } },
    } as any;

    const result = await scoreFaithfulness(
      'query',
      'The building must be painted blue every 5 years.',
      [],
      { client: mockClient }
    );

    expect(result.score).toBe(4);
    expect(result.flaggedClaims).toHaveLength(1);
  });

  it('handles malformed JSON response gracefully', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: '{"score": 5}',
          },
        },
      ],
    });

    const mockClient = {
      chat: { completions: { create: mockCreate } },
    } as any;

    const result = await scoreFaithfulness('query', 'answer', [], { client: mockClient });

    expect(result.score).toBe(5);
    expect(result.reasoning).toBe('Failed to evaluate');
    expect(result.flaggedClaims).toEqual([]);
  });

  it('handles empty response content', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: null,
          },
        },
      ],
    });

    const mockClient = {
      chat: { completions: { create: mockCreate } },
    } as any;

    const result = await scoreFaithfulness('query', 'answer', [], { client: mockClient });

    expect(result.score).toBe(0);
    expect(result.reasoning).toBe('Failed to evaluate');
  });

  it('calls OpenAI with gpt-4o-mini model and temperature 0', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ score: 7, reasoning: 'ok', flagged_claims: [] }),
          },
        },
      ],
    });

    const mockClient = {
      chat: { completions: { create: mockCreate } },
    } as any;

    await scoreFaithfulness('query', 'answer', [], { client: mockClient });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
      })
    );
  });

  it('includes context and answer in the evaluation prompt', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ score: 9, reasoning: 'great', flagged_claims: [] }),
          },
        },
      ],
    });

    const mockClient = {
      chat: { completions: { create: mockCreate } },
    } as any;

    const context = [makeContext('Test Code', 'Important regulation text here.')];

    await scoreFaithfulness('test query', 'test answer', context, { client: mockClient });

    const callArgs = mockCreate.mock.calls[0][0];
    const userMessage = callArgs.messages.find((m: any) => m.role === 'user');
    expect(userMessage.content).toContain('Important regulation text here.');
    expect(userMessage.content).toContain('test query');
    expect(userMessage.content).toContain('test answer');
  });
});
