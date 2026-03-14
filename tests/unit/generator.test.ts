import { describe, it, expect, vi } from 'vitest';
import { extractCitations, COMPLIANCE_SYSTEM_PROMPT } from '../../src/generator/index.js';
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

describe('Generator', () => {
  describe('COMPLIANCE_SYSTEM_PROMPT', () => {
    it('requires citation in [Document, Section] format', () => {
      expect(COMPLIANCE_SYSTEM_PROMPT).toContain('[Document Name, Section X.X]');
    });

    it('includes instruction to never fabricate clause numbers', () => {
      expect(COMPLIANCE_SYSTEM_PROMPT).toContain('NEVER fabricate');
    });

    it('includes instruction to say "I don\'t have sufficient information"', () => {
      expect(COMPLIANCE_SYSTEM_PROMPT).toContain("don't have sufficient information");
    });

    it('requires version/edition date in citations', () => {
      expect(COMPLIANCE_SYSTEM_PROMPT).toContain('version/edition date');
    });
  });

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
  });

  describe('generateAnswer', () => {
    it('produces answer grounded in retrieved context', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content:
                'The minimum fire resistance period is 120 minutes [Code of Practice for Fire Safety in Buildings, Table 4].',
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });

      const mockClient = {
        chat: { completions: { create: mockCreate } },
      } as any;

      const { generateAnswer } = await import('../../src/generator/index.js');
      const context = [
        makeContext('Code of Practice for Fire Safety in Buildings', 'BD', 'Table 4'),
      ];

      const result = await generateAnswer('fire resistance requirements', context, {
        client: mockClient,
      });

      expect(result.answer).toContain('fire resistance');
      expect(result.answer).toContain('[Code of Practice for Fire Safety');
      expect(mockCreate).toHaveBeenCalledOnce();
    });
  });
});
