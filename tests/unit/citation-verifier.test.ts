import { describe, it, expect } from 'vitest';
import { verifyCitations, appendDisclaimer } from '../../src/safety/citation-verifier.js';
import type { SearchResult } from '../../src/retrieval/hybrid-search.js';
import type { Citation } from '../../src/generator/index.js';

function makeContext(name: string, content: string, sections: string[] = []): SearchResult {
  return {
    id: 'test-id',
    content,
    score: 0.9,
    source_department: 'BD',
    document_type: 'code_of_practice',
    document_name: name,
    version: '2024',
    section_hierarchy: sections,
    page_number: 1,
    cross_references: [],
    search_method: 'hybrid',
  };
}

describe('Citation Verifier', () => {
  describe('verifyCitations', () => {
    it('verifies citations that match context documents', () => {
      const citations: Citation[] = [
        {
          document_name: 'Fire Safety Code',
          section: 'Section 17.2',
          department: 'BD',
          version: '2024',
        },
      ];
      const context = [
        makeContext('Fire Safety Code', 'Section 17.2 requirements...', ['Section 17']),
      ];

      const result = verifyCitations('answer text', citations, context);
      expect(result.verifiedCitations).toBe(1);
      expect(result.phantomCitations).toHaveLength(0);
      expect(result.citationAccuracy).toBe(1);
    });

    it('flags phantom citations not found in context', () => {
      const citations: Citation[] = [
        {
          document_name: 'Nonexistent Code',
          section: 'Section 99',
          department: 'BD',
          version: '2024',
        },
      ];
      const context = [
        makeContext('Fire Safety Code', 'Some content', ['Section 1']),
      ];

      const result = verifyCitations('answer text', citations, context);
      expect(result.phantomCitations).toHaveLength(1);
      expect(result.phantomCitations[0].document_name).toBe('Nonexistent Code');
      expect(result.citationAccuracy).toBe(0);
    });

    it('handles mixed verified and phantom citations', () => {
      const citations: Citation[] = [
        {
          document_name: 'Fire Safety Code',
          section: 'Section 17',
          department: 'BD',
          version: '2024',
        },
        {
          document_name: 'Made Up Code',
          section: 'Section 999',
          department: 'BD',
          version: '2024',
        },
      ];
      const context = [
        makeContext('Fire Safety Code', 'Section 17 content...', ['Section 17']),
      ];

      const result = verifyCitations('answer', citations, context);
      expect(result.verifiedCitations).toBe(1);
      expect(result.phantomCitations).toHaveLength(1);
      expect(result.citationAccuracy).toBe(0.5);
    });

    it('returns 100% accuracy when no citations exist', () => {
      const result = verifyCitations('answer without citations', [], []);
      expect(result.citationAccuracy).toBe(1);
    });

    it('detects uncited regulatory claims', () => {
      const answer =
        'Buildings must comply with minimum fire resistance requirements. The prescribed limit shall not be exceeded.';
      const result = verifyCitations(answer, [], []);
      expect(result.uncitedClaims.length).toBeGreaterThan(0);
    });

    it('does not flag cited regulatory claims as uncited', () => {
      const answer = 'The minimum fire resistance period must be 120 minutes [Fire Safety Code, Section 17.2].';
      const citations: Citation[] = [
        { document_name: 'Fire Safety Code', section: 'Section 17.2', department: 'BD', version: '2024' },
      ];
      const context = [makeContext('Fire Safety Code', 'Section 17.2 content', ['Section 17'])];

      const result = verifyCitations(answer, citations, context);
      expect(result.uncitedClaims).toHaveLength(0);
    });

    it('detects "shall" as regulatory language requiring citation', () => {
      const answer = 'Every building shall have at least two means of escape. This is very important for safety.';
      const result = verifyCitations(answer, [], []);
      expect(result.uncitedClaims.some((c) => c.includes('shall'))).toBe(true);
    });

    it('verifies citation via section_hierarchy match', () => {
      const citations: Citation[] = [
        { document_name: 'Some Code', section: 'Part III', department: 'BD', version: '2024' },
      ];
      const context = [
        makeContext('Some Code', 'text about fire', ['Part III', 'Section 17']),
      ];

      const result = verifyCitations('answer', citations, context);
      expect(result.verifiedCitations).toBe(1);
    });

    it('verifies citation via content text match', () => {
      const citations: Citation[] = [
        { document_name: 'Different Name', section: 'Table 4', department: 'BD', version: '2024' },
      ];
      // Content includes the section reference even though document_name doesn't match
      const context = [
        makeContext('Fire Safety Code', 'Fire resistance rating per Table 4 requirements', ['Section 17']),
      ];

      const result = verifyCitations('answer', citations, context);
      expect(result.verifiedCitations).toBe(1);
    });

    it('totalCitations equals sum of verified + phantom', () => {
      const citations: Citation[] = [
        { document_name: 'Real Code', section: 'Section 1', department: 'BD', version: '2024' },
        { document_name: 'Fake Code', section: 'Section 99', department: 'BD', version: '2024' },
        { document_name: 'Real Code', section: 'Section 2', department: 'BD', version: '2024' },
      ];
      const context = [makeContext('Real Code', 'Section 1 and Section 2 content', ['Section 1', 'Section 2'])];

      const result = verifyCitations('answer', citations, context);
      expect(result.totalCitations).toBe(3);
      expect(result.verifiedCitations + result.phantomCitations.length).toBe(3);
    });
  });

  describe('appendDisclaimer', () => {
    it('appends regulatory disclaimer to answer', () => {
      const answer = 'The fire resistance period is 120 minutes.';
      const result = appendDisclaimer(answer);
      expect(result).toContain('Disclaimer');
      expect(result).toContain('does not constitute legal advice');
      expect(result).toContain(answer);
    });

    it('preserves the original answer text before disclaimer', () => {
      const answer = 'Specific compliance requirement details here.';
      const result = appendDisclaimer(answer);
      expect(result.startsWith(answer)).toBe(true);
    });

    it('includes advice to verify with government departments', () => {
      const result = appendDisclaimer('test');
      expect(result).toContain('Hong Kong government department');
    });
  });
});
