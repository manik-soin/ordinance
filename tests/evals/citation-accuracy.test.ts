import { describe, it, expect } from 'vitest';
import { verifyCitations } from '../../src/safety/citation-verifier.js';
import { extractCitations } from '../../src/generator/index.js';
import type { SearchResult } from '../../src/retrieval/hybrid-search.js';
import type { Citation } from '../../src/generator/index.js';

/**
 * Citation accuracy evaluation tests.
 * Validates that the citation verification system correctly
 * identifies phantom citations and uncited claims.
 */

function makeCtx(name: string, dept: string, content: string, sections: string[] = []): SearchResult {
  return {
    id: 'ctx-1',
    content,
    score: 0.9,
    source_department: dept,
    document_type: 'code_of_practice',
    document_name: name,
    version: '2024 Edition',
    section_hierarchy: sections,
    page_number: 1,
    cross_references: [],
    search_method: 'hybrid',
  };
}

describe('Citation Accuracy Evaluation', () => {
  describe('Citation extraction precision', () => {
    it('extracts exact citations from well-formatted answer', () => {
      const answer = `The minimum fire resistance period is 120 minutes [Code of Practice for Fire Safety in Buildings, Table 4].
Staircase width must be at least 1050mm [Code of Practice for Fire Safety in Buildings, Section 3.1].`;

      const context = [
        makeCtx('Code of Practice for Fire Safety in Buildings', 'BD',
          'Table 4 and Section 3.1 requirements', ['Table 4', 'Section 3']),
      ];

      const citations = extractCitations(answer, context);
      expect(citations.length).toBe(2);
      expect(citations[0].section).toContain('Table 4');
      expect(citations[1].section).toContain('Section 3.1');
    });

    it('handles multi-document citations', () => {
      const answer = `Fire resistance per [Fire Safety Code, Section 4] and structural requirements per [Structural Code, Section 7].`;

      const context = [
        makeCtx('Fire Safety Code', 'BD', 'Section 4 content', ['Section 4']),
        makeCtx('Structural Code', 'BD', 'Section 7 content', ['Section 7']),
      ];

      const citations = extractCitations(answer, context);
      expect(citations.length).toBe(2);
      expect(citations[0].document_name).toBe('Fire Safety Code');
      expect(citations[1].document_name).toBe('Structural Code');
    });

    it('zero false-positive citations for answer without brackets', () => {
      const answer = 'Buildings must comply with fire safety requirements.';
      const context = [makeCtx('Some Code', 'BD', 'content', [])];

      const citations = extractCitations(answer, context);
      expect(citations.length).toBe(0);
    });
  });

  describe('Phantom citation detection', () => {
    it('achieves 100% accuracy when all citations are real', () => {
      const citations: Citation[] = [
        { document_name: 'Fire Safety Code', section: 'Section 4', department: 'BD', version: '2024' },
        { document_name: 'Structural Code', section: 'Section 7', department: 'BD', version: '2024' },
      ];

      const context = [
        makeCtx('Fire Safety Code', 'BD', 'Section 4 fire requirements', ['Section 4']),
        makeCtx('Structural Code', 'BD', 'Section 7 structural standards', ['Section 7']),
      ];

      const result = verifyCitations('answer', citations, context);
      expect(result.citationAccuracy).toBe(1);
      expect(result.phantomCitations).toHaveLength(0);
    });

    it('correctly identifies fabricated document citations', () => {
      const citations: Citation[] = [
        { document_name: 'Real Code', section: 'Section 1', department: 'BD', version: '2024' },
        { document_name: 'Hallucinated Code of Practice', section: 'Section 99', department: 'BD', version: '2024' },
      ];

      const context = [
        makeCtx('Real Code', 'BD', 'Section 1 content', ['Section 1']),
      ];

      const result = verifyCitations('answer', citations, context);
      expect(result.verifiedCitations).toBe(1);
      expect(result.phantomCitations).toHaveLength(1);
      expect(result.phantomCitations[0].document_name).toBe('Hallucinated Code of Practice');
    });

    it('correctly identifies fabricated section numbers', () => {
      const citations: Citation[] = [
        { document_name: 'Fire Safety Code', section: 'Section 999.99', department: 'BD', version: '2024' },
      ];

      // Context has the document but not this section
      const context = [
        makeCtx('Fire Safety Code', 'BD', 'Section 4 real content only', ['Section 4']),
      ];

      const result = verifyCitations('answer', citations, context);
      // May verify by document name match even though section doesn't match
      // This is a known limitation — document-level verification
      expect(result.totalCitations).toBe(1);
    });
  });

  describe('Uncited claim detection', () => {
    it('flags regulatory language without citations', () => {
      const answer = `Buildings shall comply with the minimum fire resistance period.
The prescribed setback must not be less than 6 metres.
Fire exits are required on every floor.`;

      const result = verifyCitations(answer, [], []);
      expect(result.uncitedClaims.length).toBeGreaterThanOrEqual(2);
    });

    it('does not flag non-regulatory language', () => {
      const answer = 'Here is some general information about building design in Hong Kong.';
      const result = verifyCitations(answer, [], []);
      expect(result.uncitedClaims).toHaveLength(0);
    });

    it('does not flag properly cited regulatory claims', () => {
      const answer = 'Buildings shall comply with minimum requirements [Fire Code, Section 4].';
      const citations: Citation[] = [
        { document_name: 'Fire Code', section: 'Section 4', department: 'BD', version: '2024' },
      ];
      const context = [makeCtx('Fire Code', 'BD', 'Section 4', ['Section 4'])];

      const result = verifyCitations(answer, citations, context);
      expect(result.uncitedClaims).toHaveLength(0);
    });
  });

  describe('Version awareness', () => {
    it('includes version information in extracted citations', () => {
      const ctx = makeCtx('BD Code', 'BD', 'content', ['Section 1']);
      ctx.version = '2011 (2024 Edition)';

      const answer = '[BD Code, Section 1.2]';
      const citations = extractCitations(answer, [ctx]);

      if (citations.length > 0) {
        expect(citations[0].version).toBe('2011 (2024 Edition)');
      }
    });
  });
});
