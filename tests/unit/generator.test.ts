import { describe, it, expect, vi } from 'vitest';
import {
  extractCitations,
  generateAnswer,
  streamAnswer,
  COMPLIANCE_SYSTEM_PROMPT,
} from '../../src/generator/index.js';
import type { SearchResult } from '../../src/retrieval/hybrid-search.js';

function makeContext(name: string, department: string, section: string): SearchResult {
  return {
    id: 'test-id',
    content: `Content from ${name}, ${section}`,
    score: 0.9,
    source_department: department,
    document_type: 'code_of_practice',
    document_name: name,
    version: '2024',
    section_hierarchy: [section],
    page_number: 1,
    cross_references: [],
    search_method: 'hybrid',
  };
}

// ── Helper: create a mock OpenAI client for non-streaming calls ──────────────

function makeMockClient(answer: string, usage?: { prompt_tokens: number; completion_tokens: number }) {
  const mockCreate = vi.fn().mockResolvedValue({
    choices: [{ message: { content: answer } }],
    usage: usage ?? { prompt_tokens: 100, completion_tokens: 50 },
  });
  return {
    client: { chat: { completions: { create: mockCreate } } } as any,
    mockCreate,
  };
}

// ── Helper: create a mock OpenAI streaming client ────────────────────────────

function makeMockStreamClient(chunks: string[]) {
  const asyncIterator = {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          if (index < chunks.length) {
            const value = {
              choices: [{ delta: { content: chunks[index] } }],
            };
            index++;
            return { value, done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
  };

  const mockCreate = vi.fn().mockResolvedValue(asyncIterator);
  return {
    client: { chat: { completions: { create: mockCreate } } } as any,
    mockCreate,
  };
}

describe('Generator', () => {
  // ── COMPLIANCE_SYSTEM_PROMPT ─────────────────────────────────────────────

  describe('COMPLIANCE_SYSTEM_PROMPT', () => {
    it('requires citation in [Document, Section] format', () => {
      expect(COMPLIANCE_SYSTEM_PROMPT).toContain('[Document Name (Dept), Version, Section X.X]');
    });

    it('includes instruction to never fabricate clause numbers', () => {
      expect(COMPLIANCE_SYSTEM_PROMPT).toContain('NEVER fabricate');
    });

    it('includes guidance for when context is insufficient', () => {
      expect(COMPLIANCE_SYSTEM_PROMPT).toContain('clearly unrelated to the question');
    });

    it('requires version/edition date in citations', () => {
      expect(COMPLIANCE_SYSTEM_PROMPT).toContain('version/edition date');
    });

    it('contains all 9 rules', () => {
      for (let i = 1; i <= 9; i++) {
        expect(COMPLIANCE_SYSTEM_PROMPT).toContain(`${i}.`);
      }
    });

    it('rule 1: primarily answer based on retrieved text', () => {
      expect(COMPLIANCE_SYSTEM_PROMPT).toContain('PRIMARILY answer based on the retrieved regulation text');
    });

    it('rule 3: allows parametric fallback for unrelated context', () => {
      expect(COMPLIANCE_SYSTEM_PROMPT).toContain('answer using your regulatory knowledge');
    });

    it('rule 5: requires explicit cross-reference notation', () => {
      expect(COMPLIANCE_SYSTEM_PROMPT).toContain('cross-reference');
    });

    it('rule 7: flag superseded or amended regulations', () => {
      expect(COMPLIANCE_SYSTEM_PROMPT).toContain('superseded or amended');
    });
  });

  // ── extractCitations ─────────────────────────────────────────────────────

  describe('extractCitations', () => {
    it('extracts citations matching context documents', () => {
      const answer =
        'The fire safety requirements are defined in [Code of Practice for Fire Safety in Buildings, Section 17.2].';
      const context = [
        makeContext('Code of Practice for Fire Safety in Buildings', 'BD', 'Section 17'),
      ];

      const citations = extractCitations(answer, context);
      expect(citations.length).toBeGreaterThanOrEqual(1);
      expect(citations[0].document_name).toBe('Code of Practice for Fire Safety in Buildings');
    });

    it('extracts multiple citations', () => {
      const answer =
        'According to [BD Fire Safety Code, Part III] and [BD Structural Code, Section 5.1].';
      const context = [
        makeContext('BD Fire Safety Code', 'BD', 'Part III'),
        makeContext('BD Structural Code', 'BD', 'Section 5'),
      ];

      const citations = extractCitations(answer, context);
      expect(citations.length).toBe(2);
    });

    it('returns empty array when no citations found', () => {
      const answer = 'Buildings must comply with safety requirements.';
      const citations = extractCitations(answer, []);
      expect(citations).toEqual([]);
    });

    it('includes department in citation metadata', () => {
      const answer = '[BD Code, Section 1]';
      const context = [makeContext('BD Code', 'BD', 'Section 1')];

      const citations = extractCitations(answer, context);
      if (citations.length > 0) {
        expect(citations[0].department).toBe('BD');
      }
    });

    // ── New edge cases ───────────────────────────────────────────────────

    it('handles multiple citations referencing the same document', () => {
      const answer =
        'See [Fire Code, Section 3.1] for general rules and [Fire Code, Section 7.4] for exceptions.';
      const context = [makeContext('Fire Code', 'BD', 'Section 3')];

      const citations = extractCitations(answer, context);
      expect(citations.length).toBe(2);
      expect(citations[0].document_name).toBe('Fire Code');
      expect(citations[1].document_name).toBe('Fire Code');
      // The section text should differ
      expect(citations[0].section).toContain('3.1');
      expect(citations[1].section).toContain('7.4');
    });

    it('matches citation by department when document name does not match', () => {
      const answer = 'According to [BD guidelines, Clause 12.3], the setback is required.';
      const context = [makeContext('Some Other Document', 'BD', 'Clause 12')];

      const citations = extractCitations(answer, context);
      // Should match via department "BD"
      expect(citations.length).toBe(1);
      expect(citations[0].department).toBe('BD');
      expect(citations[0].section).toContain('Clause 12.3');
    });

    it('handles Clause, Part, and Table format variations', () => {
      const answer =
        'Requirements in [Foundations Code, Clause 4.2A] and [Foundations Code, Table 5.1] and [Foundations Code, Part 3].';
      const context = [makeContext('Foundations Code', 'BD', 'Various')];

      const citations = extractCitations(answer, context);
      expect(citations.length).toBe(3);
      expect(citations[0].section).toContain('Clause 4.2A');
      expect(citations[1].section).toContain('Table 5.1');
      expect(citations[2].section).toContain('Part 3');
    });

    it('returns empty citations when bracket text does not match any context', () => {
      const answer = 'Some claim based on [Unknown Document, Section 99].';
      const context = [makeContext('Completely Different Doc', 'FSD', 'Section 1')];

      const citations = extractCitations(answer, context);
      expect(citations).toHaveLength(0);
    });

    it('preserves version and page_number from context in citation', () => {
      const ctx = makeContext('BD Code', 'BD', 'Section 2');
      ctx.version = '2011 (2024 Edition)';
      ctx.page_number = 42;

      const answer = '[BD Code, Section 2.5]';
      const citations = extractCitations(answer, [ctx]);

      expect(citations.length).toBe(1);
      expect(citations[0].version).toBe('2011 (2024 Edition)');
      expect(citations[0].page_number).toBe(42);
    });
  });

  // ── generateAnswer ───────────────────────────────────────────────────────

  describe('generateAnswer', () => {
    it('produces answer grounded in retrieved context', async () => {
      const { client, mockCreate } = makeMockClient(
        'The minimum fire resistance period is 120 minutes [Code of Practice for Fire Safety in Buildings, Table 4].'
      );

      const context = [
        makeContext('Code of Practice for Fire Safety in Buildings', 'BD', 'Table 4'),
      ];

      const result = await generateAnswer('fire resistance requirements', context, {
        client,
      });

      expect(result.answer).toContain('fire resistance');
      expect(result.answer).toContain('[Code of Practice for Fire Safety');
      expect(mockCreate).toHaveBeenCalledOnce();
    });

    it('passes system prompt as the first message', async () => {
      const { client, mockCreate } = makeMockClient('answer');
      const context = [makeContext('Doc', 'BD', 'S1')];

      await generateAnswer('question', context, { client });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.messages[0].role).toBe('system');
      expect(callArgs.messages[0].content).toBe(COMPLIANCE_SYSTEM_PROMPT);
    });

    it('includes context in the user message', async () => {
      const { client, mockCreate } = makeMockClient('answer');
      const context = [makeContext('Fire Code', 'BD', 'Section 5')];

      await generateAnswer('fire resistance', context, { client });

      const callArgs = mockCreate.mock.calls[0][0];
      const userMessage = callArgs.messages[1];
      expect(userMessage.role).toBe('user');
      expect(userMessage.content).toContain('Fire Code');
      expect(userMessage.content).toContain('BD');
      expect(userMessage.content).toContain('Section 5');
      expect(userMessage.content).toContain('fire resistance');
    });

    it('includes supplementary official references when provided', async () => {
      const { client, mockCreate } = makeMockClient('answer');
      const context = [makeContext('Fire Code', 'BD', 'Section 5')];

      await generateAnswer('fire resistance', context, {
        client,
        supplementaryContext: '[Live Web Sources]\n- Official reference',
      });

      const callArgs = mockCreate.mock.calls[0][0];
      const userMessage = callArgs.messages[1];
      expect(userMessage.content).toContain('Supplementary official references');
      expect(userMessage.content).toContain('Official reference');
    });

    it('uses temperature 0.1', async () => {
      const { client, mockCreate } = makeMockClient('answer');
      const context = [makeContext('Doc', 'BD', 'S1')];

      await generateAnswer('q', context, { client });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.temperature).toBe(0.1);
    });

    it('returns token usage from response', async () => {
      const { client } = makeMockClient('answer', {
        prompt_tokens: 200,
        completion_tokens: 75,
      });
      const context = [makeContext('Doc', 'BD', 'S1')];

      const result = await generateAnswer('q', context, { client });

      expect(result.prompt_tokens).toBe(200);
      expect(result.completion_tokens).toBe(75);
    });

    it('defaults model to gpt-5.4', async () => {
      const { client, mockCreate } = makeMockClient('answer');
      const context = [makeContext('Doc', 'BD', 'S1')];

      const result = await generateAnswer('q', context, { client });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.model).toBe('gpt-5.4');
      expect(result.model).toBe('gpt-5.4');
    });

    it('uses custom model when specified', async () => {
      const { client, mockCreate } = makeMockClient('answer');
      const context = [makeContext('Doc', 'BD', 'S1')];

      const result = await generateAnswer('q', context, { client, model: 'gpt-5.2' });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.model).toBe('gpt-5.2');
      expect(result.model).toBe('gpt-5.2');
    });
  });

  // ── streamAnswer ─────────────────────────────────────────────────────────

  describe('streamAnswer', () => {
    it('yields individual token chunks from the stream', async () => {
      const tokens = ['Hello', ' world', '!'];
      const { client } = makeMockStreamClient(tokens);
      const context = [makeContext('Doc', 'BD', 'S1')];

      const collected: string[] = [];
      for await (const chunk of streamAnswer('q', context, { client })) {
        collected.push(chunk);
      }

      expect(collected).toEqual(['Hello', ' world', '!']);
    });

    it('passes system prompt as the first message', async () => {
      const { client, mockCreate } = makeMockStreamClient(['tok']);
      const context = [makeContext('Doc', 'BD', 'S1')];

      // Consume the generator
      for await (const _ of streamAnswer('q', context, { client })) {
        // drain
      }

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.messages[0].role).toBe('system');
      expect(callArgs.messages[0].content).toBe(COMPLIANCE_SYSTEM_PROMPT);
    });

    it('includes context in the user message', async () => {
      const { client, mockCreate } = makeMockStreamClient(['tok']);
      const context = [makeContext('Structural Code', 'BD', 'Section 8')];

      for await (const _ of streamAnswer('question', context, { client })) {
        // drain
      }

      const callArgs = mockCreate.mock.calls[0][0];
      const userMessage = callArgs.messages[1];
      expect(userMessage.role).toBe('user');
      expect(userMessage.content).toContain('Structural Code');
      expect(userMessage.content).toContain('question');
    });

    it('requests streaming with stream: true', async () => {
      const { client, mockCreate } = makeMockStreamClient(['tok']);
      const context = [makeContext('Doc', 'BD', 'S1')];

      for await (const _ of streamAnswer('q', context, { client })) {
        // drain
      }

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.stream).toBe(true);
    });

    it('uses temperature 0.1', async () => {
      const { client, mockCreate } = makeMockStreamClient(['tok']);
      const context = [makeContext('Doc', 'BD', 'S1')];

      for await (const _ of streamAnswer('q', context, { client })) {
        // drain
      }

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.temperature).toBe(0.1);
    });

    it('skips chunks with no delta content', async () => {
      // Simulate a stream where some chunks have empty delta
      const asyncIterator = {
        [Symbol.asyncIterator]() {
          const items = [
            { choices: [{ delta: { content: 'A' } }] },
            { choices: [{ delta: { content: undefined } }] },
            { choices: [{ delta: {} }] },
            { choices: [{ delta: { content: 'B' } }] },
          ];
          let index = 0;
          return {
            async next() {
              if (index < items.length) {
                return { value: items[index++], done: false };
              }
              return { value: undefined, done: true };
            },
          };
        },
      };
      const mockCreate = vi.fn().mockResolvedValue(asyncIterator);
      const client = { chat: { completions: { create: mockCreate } } } as any;
      const context = [makeContext('Doc', 'BD', 'S1')];

      const collected: string[] = [];
      for await (const chunk of streamAnswer('q', context, { client })) {
        collected.push(chunk);
      }

      expect(collected).toEqual(['A', 'B']);
    });

    it('handles empty stream gracefully', async () => {
      const { client } = makeMockStreamClient([]);
      const context = [makeContext('Doc', 'BD', 'S1')];

      const collected: string[] = [];
      for await (const chunk of streamAnswer('q', context, { client })) {
        collected.push(chunk);
      }

      expect(collected).toEqual([]);
    });
  });
});
