import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractSections } from '../../src/parser/index.js';

// Single top-level mock for pdf-parse. The PDFParse constructor implementation
// is set per-test via vi.mocked().
vi.mock('pdf-parse', () => {
  return {
    PDFParse: vi.fn(),
  };
});

// Helper to configure the PDFParse mock for parsePdf tests.
async function setupPdfParseMock(opts: {
  total?: number;
  text: string;
  pages: Array<{ num: number; text: string }>;
  destroyFn?: ReturnType<typeof vi.fn>;
}) {
  const { PDFParse } = await import('pdf-parse');
  const MockPDFParse = vi.mocked(PDFParse);
  const destroy = opts.destroyFn ?? vi.fn().mockResolvedValue(undefined);

  MockPDFParse.mockImplementation(function (this: unknown) {
    return {
      getInfo: vi.fn().mockResolvedValue({ total: opts.total }),
      getText: vi.fn().mockResolvedValue({
        text: opts.text,
        pages: opts.pages,
      }),
      destroy,
    };
  } as unknown as (...args: unknown[]) => unknown);

  return { destroy, MockPDFParse };
}

describe('PDF Parser', () => {
  describe('extractSections', () => {
    it('extracts Part-level sections', () => {
      const text = `PART I — GENERAL
This part covers general provisions.

PART II — FIRE SAFETY
This part covers fire safety requirements.`;

      const sections = extractSections(text);
      expect(sections.length).toBeGreaterThanOrEqual(2);
      expect(sections[0].title).toContain('PART I');
      expect(sections[0].level).toBe(1);
    });

    it('extracts Section-level sections', () => {
      const text = `Section 1 — Application
This section applies to all buildings.

Section 2 — Definitions
In this code, the following terms have the meanings given.`;

      const sections = extractSections(text);
      expect(sections.length).toBeGreaterThanOrEqual(2);
      expect(sections[0].title).toContain('Section 1');
      expect(sections[0].level).toBe(2);
    });

    it('extracts Clause-level sections', () => {
      const text = `1.1 Scope of Application
This clause defines the scope.

1.2 Referenced Documents
The following documents are referenced.

2.1 General Requirements
Buildings shall comply with the following.`;

      const sections = extractSections(text);
      expect(sections.length).toBeGreaterThanOrEqual(3);
      expect(sections[0].title).toContain('1.1');
      expect(sections[0].level).toBe(3);
    });

    it('nests sections into hierarchy', () => {
      const text = `PART I — GENERAL

Section 1 — Application
This section applies.

1.1 Scope
The scope is defined here.

1.2 Limitations
Some limitations apply.

PART II — REQUIREMENTS

Section 2 — Structural
Structural requirements follow.`;

      const sections = extractSections(text);
      // PART I should contain Section 1, which should contain 1.1 and 1.2
      expect(sections[0].title).toContain('PART I');
      expect(sections[0].children.length).toBeGreaterThanOrEqual(1);
    });

    it('preserves content within sections', () => {
      const text = `Section 1 — Application
This section establishes the requirements for fire safety in buildings.
All new buildings must comply with these provisions.

Section 2 — Definitions
Terms used in this code are defined below.`;

      const sections = extractSections(text);
      expect(sections[0].content).toContain('fire safety');
      expect(sections[0].content).toContain('comply');
    });

    it('handles empty text gracefully', () => {
      const sections = extractSections('');
      expect(sections).toEqual([]);
    });

    it('handles text with no section markers', () => {
      const text = 'This is plain text without any section structure.';
      const sections = extractSections(text);
      expect(sections).toEqual([]);
    });
  });

  describe('extractTitle (via parsePdf)', () => {

    it('extracts title from first meaningful line (length > 10 and < 200)', async () => {
      const titleLine = 'Code of Practice for Fire Safety in Buildings 2011';
      const fullText = `${titleLine}\n\nPART I — GENERAL\nSome content here.`;

      await setupPdfParseMock({
        total: 5,
        text: fullText,
        pages: [
          { num: 1, text: titleLine },
          { num: 2, text: 'PART I — GENERAL\nSome content here.' },
        ],
      });

      const { parsePdf } = await import('../../src/parser/index.js');
      const result = await parsePdf(Buffer.from('fake-pdf'));

      expect(result.title).toBe(titleLine);
    });

    it('returns "Unknown Document" when all lines are too short', async () => {
      const fullText = 'Short\nA\nB\nC\nD\nE\nF\nG\nH\nI';

      await setupPdfParseMock({
        total: 1,
        text: fullText,
        pages: [{ num: 1, text: fullText }],
      });

      const { parsePdf } = await import('../../src/parser/index.js');
      const result = await parsePdf(Buffer.from('fake-pdf'));

      expect(result.title).toBe('Unknown Document');
    });

    it('skips blank lines and picks first line between 10 and 200 chars', async () => {
      const titleLine = 'Hong Kong Building Ordinance Cap 123';
      const fullText = `\n\n   \n${titleLine}\nMore text follows here.`;

      await setupPdfParseMock({
        total: 1,
        text: fullText,
        pages: [{ num: 1, text: fullText }],
      });

      const { parsePdf } = await import('../../src/parser/index.js');
      const result = await parsePdf(Buffer.from('fake-pdf'));

      expect(result.title).toBe(titleLine);
    });

    it('skips lines longer than 200 characters', async () => {
      const longLine = 'A'.repeat(201);
      const goodTitle = 'Proper Document Title Here';
      const fullText = `${longLine}\n${goodTitle}\nBody text.`;

      await setupPdfParseMock({
        total: 1,
        text: fullText,
        pages: [{ num: 1, text: fullText }],
      });

      const { parsePdf } = await import('../../src/parser/index.js');
      const result = await parsePdf(Buffer.from('fake-pdf'));

      expect(result.title).toBe(goodTitle);
    });
  });

  describe('nestSections — deeper nesting (3+ levels)', () => {
    it('nests Part > Section > Clause into 3-level hierarchy', () => {
      const text = `PART I — GENERAL

Section 1 — Application
This section applies to all buildings.

1.1 Scope
Defines the scope of this section.

1.2 Definitions
Key terms are defined here.

Section 2 — Enforcement
How this code is enforced.

2.1 Penalties
Penalties for non-compliance.

PART II — FIRE SAFETY

Section 3 — Fire Resistance
Fire resistance requirements.

3.1 Compartmentation
Building compartment rules.

3.1.1 Sub-clause detail
Additional detail on compartments.`;

      const sections = extractSections(text);

      // Top level should have 2 parts
      expect(sections).toHaveLength(2);
      expect(sections[0].title).toContain('PART I');
      expect(sections[1].title).toContain('PART II');

      // PART I children: Section 1 and Section 2
      expect(sections[0].children).toHaveLength(2);
      expect(sections[0].children[0].title).toContain('Section 1');
      expect(sections[0].children[0].level).toBe(2);
      expect(sections[0].children[1].title).toContain('Section 2');

      // Section 1 children: 1.1 and 1.2
      expect(sections[0].children[0].children).toHaveLength(2);
      expect(sections[0].children[0].children[0].title).toContain('1.1');
      expect(sections[0].children[0].children[0].level).toBe(3);
      expect(sections[0].children[0].children[1].title).toContain('1.2');

      // Section 2 children: 2.1
      expect(sections[0].children[1].children).toHaveLength(1);
      expect(sections[0].children[1].children[0].title).toContain('2.1');

      // PART II children: Section 3
      expect(sections[1].children).toHaveLength(1);
      expect(sections[1].children[0].title).toContain('Section 3');

      // Section 3 children: 3.1 and 3.1.1 (both are clause-level)
      expect(sections[1].children[0].children.length).toBeGreaterThanOrEqual(1);
    });

    it('handles sibling sections at same level without nesting them', () => {
      const text = `Section 1 — First
Content of first section.

Section 2 — Second
Content of second section.

Section 3 — Third
Content of third section.`;

      const sections = extractSections(text);
      // All are level 2, so they should all be at root level
      expect(sections).toHaveLength(3);
      expect(sections[0].children).toHaveLength(0);
      expect(sections[1].children).toHaveLength(0);
      expect(sections[2].children).toHaveLength(0);
    });

    it('pops stack correctly when a higher-level section follows a deep one', () => {
      const text = `PART I — INTRO

Section 1 — Overview
Overview content.

1.1 Detail A
Detail A content.

1.2 Detail B
Detail B content.

PART II — SPECIFICS

Section 2 — Materials
Materials content.`;

      const sections = extractSections(text);

      // PART II should be at root, not nested under 1.2 or Section 1
      expect(sections).toHaveLength(2);
      expect(sections[1].title).toContain('PART II');
      expect(sections[1].level).toBe(1);
      expect(sections[1].children).toHaveLength(1);
      expect(sections[1].children[0].title).toContain('Section 2');
    });

    it('handles clause-level sections before any Part or Section', () => {
      const text = `1.1 Preliminary
This is a preliminary clause.

1.2 Application
Application details.

PART I — MAIN
Main body.`;

      const sections = extractSections(text);
      // 1.1 and 1.2 are at root since no parent Part/Section precedes them
      // PART I is also at root
      expect(sections).toHaveLength(3);
      expect(sections[0].title).toContain('1.1');
      expect(sections[1].title).toContain('1.2');
      expect(sections[2].title).toContain('PART I');
    });
  });

  describe('parsePdf — main entry point', () => {

    it('returns a complete ParsedDocument with correct structure', async () => {
      const fullText = 'Code of Practice for Structural Use of Concrete 2013\n\nPART I — GENERAL\nGeneral provisions.\n\nSection 1 — Scope\nThis code applies to concrete structures.\n\n1.1 Referenced Standards\nThe following standards are referenced.';

      await setupPdfParseMock({
        total: 3,
        text: fullText,
        pages: [
          { num: 1, text: 'Code of Practice for Structural Use of Concrete 2013' },
          { num: 2, text: 'PART I — GENERAL\nGeneral provisions.\n\nSection 1 — Scope\nThis code applies to concrete structures.' },
          { num: 3, text: '1.1 Referenced Standards\nThe following standards are referenced.' },
        ],
      });

      const { parsePdf } = await import('../../src/parser/index.js');
      const result = await parsePdf(Buffer.from('fake-pdf-buffer'));

      expect(result.title).toBe('Code of Practice for Structural Use of Concrete 2013');
      expect(result.pageCount).toBe(3);
      expect(result.pages).toHaveLength(3);
      expect(result.pages[0].pageNumber).toBe(1);
      expect(result.pages[2].pageNumber).toBe(3);
      expect(result.fullText).toContain('PART I');
      expect(result.sections.length).toBeGreaterThanOrEqual(1);
      expect(result.sections[0].title).toContain('PART I');
    });

    it('defaults to 1 page when getInfo returns no total', async () => {
      await setupPdfParseMock({
        text: 'Single page document with enough characters for a title',
        pages: [{ num: 1, text: 'Single page document with enough characters for a title' }],
      });

      const { parsePdf } = await import('../../src/parser/index.js');
      const result = await parsePdf(Buffer.from('fake-pdf'));

      expect(result.pageCount).toBe(1);
    });

    it('calls destroy on the parser after extraction', async () => {
      const destroyMock = vi.fn().mockResolvedValue(undefined);

      await setupPdfParseMock({
        total: 1,
        text: 'A document title line that is long enough\nSome body.',
        pages: [{ num: 1, text: 'A document title line that is long enough\nSome body.' }],
        destroyFn: destroyMock,
      });

      const { parsePdf } = await import('../../src/parser/index.js');
      await parsePdf(Buffer.from('fake-pdf'));

      expect(destroyMock).toHaveBeenCalledOnce();
    });

    it('handles document with no sections, only body text', async () => {
      await setupPdfParseMock({
        total: 1,
        text: 'This document has no section headings at all, just plain body text that goes on.',
        pages: [{ num: 1, text: 'This document has no section headings at all, just plain body text that goes on.' }],
      });

      const { parsePdf } = await import('../../src/parser/index.js');
      const result = await parsePdf(Buffer.from('fake-pdf'));

      expect(result.sections).toEqual([]);
      expect(result.fullText).toContain('no section headings');
    });
  });

  describe('extractPages fallback — character-count splitting', () => {
    it('splits by character count when form-feeds are fewer than expected pages', async () => {
      // getInfo says total: 5 but text has 0 form feeds,
      // so form-feed splitting produces only 1 raw page (< 5 * 0.8 = 4).
      // The fallback should split by character count into 5 pages.
      const textContent = 'A'.repeat(500); // 500 chars, no form feeds

      await setupPdfParseMock({
        total: 5,
        text: textContent,
        // Simulate the fallback: provide pages split by character count
        // (each page ~100 chars for 500 chars / 5 pages)
        pages: [
          { num: 1, text: 'A'.repeat(100) },
          { num: 2, text: 'A'.repeat(100) },
          { num: 3, text: 'A'.repeat(100) },
          { num: 4, text: 'A'.repeat(100) },
          { num: 5, text: 'A'.repeat(100) },
        ],
      });

      const { parsePdf } = await import('../../src/parser/index.js');
      const result = await parsePdf(Buffer.from('fake-pdf'));

      expect(result.pageCount).toBe(5);
      expect(result.pages).toHaveLength(5);
      // Each page should have content (not empty)
      for (const page of result.pages) {
        expect(page.text.length).toBeGreaterThan(0);
      }
      // Pages should be numbered sequentially
      expect(result.pages[0].pageNumber).toBe(1);
      expect(result.pages[4].pageNumber).toBe(5);
    });
  });

  describe('estimatePageNumber (via extractSections)', () => {
    it('assigns page number 1 when no form feeds exist', () => {
      const text = `PART I — GENERAL
Some content here.`;

      const sections = extractSections(text);
      expect(sections[0].pageNumber).toBe(1);
    });

    it('estimates page number based on form feed positions', () => {
      // Form feeds separate pages; section headers must start at beginning of a line
      const text = 'Page 1 content here.\f\nPage 2 content here.\f\nPART I — GENERAL\nContent on page 3.';

      const sections = extractSections(text);
      expect(sections).toHaveLength(1);
      expect(sections[0].pageNumber).toBe(3);
    });

    it('assigns correct page numbers for sections across multiple pages', () => {
      const text = 'PART I — GENERAL\nFirst page content.\f\nPART II — SPECIFICS\nSecond page content.';

      const sections = extractSections(text);
      expect(sections).toHaveLength(2);
      expect(sections[0].pageNumber).toBe(1);
      expect(sections[1].pageNumber).toBe(2);
    });
  });
});
