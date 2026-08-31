import { describe, it, expect } from 'vitest';
import { verifyAgentCitations } from '../../src/agent/citation-gate.js';
import type { SearchResult } from '../../src/retrieval/hybrid-search.js';

const DOC = 'Code of Practice for Fire Safety in Buildings';

function chunk(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 'c1',
    content:
      'This is from Code of Practice for Fire Safety in Buildings. Section 4.1 requires a fire resistance rating of not less than 120 minutes.',
    score: 0.9,
    source_department: 'BD',
    document_type: 'code_of_practice',
    document_name: DOC,
    version: '2011 (2024 Edition)',
    section_hierarchy: ['Part C', 'Section 4.1'],
    page_number: 12,
    cross_references: [],
    search_method: 'hybrid',
    ...overrides,
  };
}

describe('verifyAgentCitations (strict exit gate)', () => {
  it('verifies a citation whose document and section are both grounded', () => {
    const answer = `The rating is 120 minutes [${DOC} (BD), 2011 (2024 Edition), Section 4.1].`;
    const { verification } = verifyAgentCitations(answer, [chunk()]);
    expect(verification.totalCitations).toBe(1);
    expect(verification.verifiedCitations).toBe(1);
    expect(verification.phantomCitations).toHaveLength(0);
    expect(verification.citationAccuracy).toBe(1);
  });

  it('flags a fabricated SECTION on a real document as a phantom', () => {
    // The old shared verifier laundered this into a verified citation.
    const answer = `The rule is clear [${DOC} (BD), 2011, Section 99.9].`;
    const { verification } = verifyAgentCitations(answer, [chunk()]);
    expect(verification.totalCitations).toBe(1);
    expect(verification.verifiedCitations).toBe(0);
    expect(verification.phantomCitations).toHaveLength(1);
    expect(verification.phantomCitations[0].section).toMatch(/99\.9/);
    expect(verification.citationAccuracy).toBe(0);
  });

  it('flags a citation to a document that was never retrieved (fabricated doc)', () => {
    const answer =
      'Escape widths must be 1050mm [Fabricated Escape Manual (BD), 2019, Section 3.2].';
    const { verification } = verifyAgentCitations(answer, [chunk()]);
    expect(verification.totalCitations).toBe(1);
    expect(verification.phantomCitations).toHaveLength(1);
    expect(verification.citationAccuracy).toBe(0);
  });

  it('does not launder a fabricated doc via the bare department substring', () => {
    // "(BD)" alone must not match the real BD document.
    const answer = 'Per the code [Made Up Doc (BD), 2020, Clause 7.7].';
    const { verification } = verifyAgentCitations(answer, [chunk()]);
    expect(verification.verifiedCitations).toBe(0);
    expect(verification.phantomCitations).toHaveLength(1);
  });

  it('grounds a section identifier via the section hierarchy, not just content', () => {
    const c = chunk({
      content: 'Provisions of means of escape apply to all buildings.',
      section_hierarchy: ['Part B', 'Clause B4.1'],
    });
    const answer = `Occupant capacity is assessed under [${DOC} (BD), 2011 (2024 Edition), Clause B4.1].`;
    const { verification } = verifyAgentCitations(answer, [c]);
    expect(verification.verifiedCitations).toBe(1);
    expect(verification.phantomCitations).toHaveLength(0);
  });

  it('ignores non-citation brackets like live-data notes', () => {
    const answer =
      'REGAL is not on the approved list [live BD fire_doorsets dataset query result].';
    const { verification } = verifyAgentCitations(answer, [chunk()]);
    expect(verification.totalCitations).toBe(0);
    expect(verification.citationAccuracy).toBe(1);
  });

  it('handles an empty chunk store: any specific citation is a phantom', () => {
    const answer = 'The limit shall be 120 minutes [Some Code (BD), 2011, Section 3.2].';
    const { verification } = verifyAgentCitations(answer, []);
    expect(verification.phantomCitations).toHaveLength(1);
    expect(verification.citationAccuracy).toBe(0);
  });

  it('does not false-flag a Part identifier using a common bigram', () => {
    // "IV" must match as a word, not inside "service"/"derivation".
    const c = chunk({
      content: 'The provisions of this service apply generally to derivation of loads.',
      section_hierarchy: ['Part A'],
    });
    const answer = `Escape routes are subject to [${DOC} (BD), 2011, Part IV].`;
    const { verification } = verifyAgentCitations(answer, [c]);
    expect(verification.phantomCitations).toHaveLength(1);
  });
});
