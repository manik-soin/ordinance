import { describe, it, expect, vi } from 'vitest';
import { scoreFaithfulness } from '../../src/safety/faithfulness.js';
import type { SearchResult } from '../../src/retrieval/hybrid-search.js';

/**
 * Faithfulness evaluation tests.
 *
 * These tests can run in two modes:
 * 1. With mocked LLM (always runs) — validates evaluation logic
 * 2. With real LLM (when OPENAI_API_KEY set) — validates actual scoring
 *
 * Run with: npm run test:evals
 */

function makeContext(name: string, content: string): SearchResult {
  return {
    id: 'ctx-id',
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

describe('Faithfulness Evaluation', () => {
  describe('Mock-based evaluation logic', () => {
    it('high score (≥7) for faithful answer', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              score: 9,
              reasoning: 'All claims are directly supported by the source text',
              flagged_claims: [],
            }),
          },
        }],
      });
      const mockClient = { chat: { completions: { create: mockCreate } } } as any;

      const context = [makeContext('Fire Safety Code',
        'The minimum fire resistance period for structural elements in buildings over 25m is 2 hours.')];

      const result = await scoreFaithfulness(
        'What is the fire resistance period for buildings over 25m?',
        'The minimum fire resistance period is 2 hours for structural elements in buildings over 25m [Fire Safety Code, Section 1].',
        context,
        { client: mockClient }
      );

      expect(result.score).toBeGreaterThanOrEqual(7);
      expect(result.flaggedClaims).toHaveLength(0);
    });

    it('low score (≤3) for fabricated answer (negative control)', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              score: 1,
              reasoning: 'Answer contains completely fabricated requirements not in source',
              flagged_claims: [
                'Buildings must be painted green every 3 years',
                'All windows must face south',
              ],
            }),
          },
        }],
      });
      const mockClient = { chat: { completions: { create: mockCreate } } } as any;

      const context = [makeContext('Fire Safety Code', 'Fire resistance period is 2 hours.')];

      const result = await scoreFaithfulness(
        'What are the painting requirements?',
        'Buildings must be painted green every 3 years. All windows must face south.',
        context,
        { client: mockClient }
      );

      expect(result.score).toBeLessThanOrEqual(3);
      expect(result.flaggedClaims.length).toBeGreaterThan(0);
    });

    it('medium score (4-6) for partially supported answer', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              score: 5,
              reasoning: 'Fire resistance claim is supported but staircase width claim is fabricated',
              flagged_claims: ['minimum staircase width of 1500mm'],
            }),
          },
        }],
      });
      const mockClient = { chat: { completions: { create: mockCreate } } } as any;

      const context = [makeContext('Fire Safety Code', 'Fire resistance period is 2 hours.')];

      const result = await scoreFaithfulness(
        'What are the requirements?',
        'The fire resistance period is 2 hours. The minimum staircase width is 1500mm.',
        context,
        { client: mockClient }
      );

      expect(result.score).toBeGreaterThanOrEqual(4);
      expect(result.score).toBeLessThanOrEqual(6);
      expect(result.flaggedClaims.length).toBeGreaterThan(0);
    });

    it('includes source context and answer in evaluation prompt', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({ score: 8, reasoning: 'good', flagged_claims: [] }),
          },
        }],
      });
      const mockClient = { chat: { completions: { create: mockCreate } } } as any;

      const context = [makeContext('Test Doc', 'Unique context string XYZ-123')];

      await scoreFaithfulness(
        'test query ABC',
        'test answer DEF',
        context,
        { client: mockClient }
      );

      const callArgs = mockCreate.mock.calls[0][0];
      const userMsg = callArgs.messages.find((m: any) => m.role === 'user');
      expect(userMsg.content).toContain('Unique context string XYZ-123');
      expect(userMsg.content).toContain('test query ABC');
      expect(userMsg.content).toContain('test answer DEF');
    });
  });

  // These tests require OPENAI_API_KEY — skip in CI
  describe.skipIf(!process.env.OPENAI_API_KEY)('Live LLM evaluation', () => {
    it.todo('scores ≥ 7/10 for factual questions from golden set');
    it.todo('scores ≥ 8/10 for single-section factual questions');
    it.todo('scores ≤ 3/10 for fabricated answers (negative control)');
    it.todo('detects when answer contradicts source material');
    it.todo('flags hallucinated regulation numbers');
  });
});
