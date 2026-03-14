import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractSections } from '../../src/parser/index.js';
import { chunkDocument, chunkPlainText, extractCrossReferences } from '../../src/chunker/index.js';
import type { RegulationSource } from '../../src/sources/buildings-dept.js';
import { computeHash } from '../../src/scraper/index.js';

/**
 * Integration tests for the ingestion pipeline.
 * These test the parse → chunk → metadata flow without external deps.
 */

const FIRE_SAFETY_TEXT = `
Code of Practice for Fire Safety in Buildings 2011

PART I — GENERAL

Section 1 — Introduction
1.1 This Code of Practice for Fire Safety in Buildings sets out the minimum fire safety
requirements that should be incorporated in the design and construction of buildings.
It provides guidance on fire safety measures that should be considered for
new building works as described in Cap. 123.

1.2 Application
This Code applies to all buildings in Hong Kong as defined in the Buildings Ordinance
(Cap. 123). Compliance with the Code is mandatory under Section 16(1) of Cap. 123.
See also PNAP ADV-33 for additional guidance.

PART II — MEANS OF ESCAPE

Section 2 — General Requirements for Means of Escape
2.1 Width of Exit Routes
The width of any exit route shall not be less than the minimum width specified in
Table 5. For buildings exceeding 25 metres in height, the requirements in Part III
shall also apply.

2.2 Travel Distance
The maximum travel distance from any point in a building to the nearest exit shall
not exceed the values specified in Table 6. Dead-end corridors shall not exceed 18 metres.

Section 3 — Staircases
3.1 Number of Staircases
Every building of more than 3 storeys shall have at least two staircases.
The minimum width of each staircase shall be 1050mm for buildings up to 25m,
and 1200mm for buildings exceeding 25m (see Cap. 123F Section 17).

3.2 Fire Resistance of Staircases
All staircases shall be enclosed in fire-resisting construction having a fire
resistance period of not less than 1 hour for buildings up to 25m, and not less
than 2 hours for buildings exceeding 25m.
`;

const testSource: RegulationSource = {
  name: 'Code of Practice for Fire Safety in Buildings',
  url: 'https://www.bd.gov.hk/doc/en/resources/codes-and-references/code-and-design-manuals/fs_code2011.pdf',
  version: '2011 (2024 Edition)',
  department: 'BD',
  type: 'code_of_practice',
  category: 'fire_safety',
};

describe('Ingestion Pipeline (integration)', () => {
  describe('Parse → Chunk flow', () => {
    it('extracts hierarchical sections from realistic regulation text', () => {
      const sections = extractSections(FIRE_SAFETY_TEXT);

      // Should have 2 top-level Parts
      expect(sections.length).toBe(2);
      expect(sections[0].title).toContain('PART I');
      expect(sections[1].title).toContain('PART II');

      // PART I has Section 1
      expect(sections[0].children.length).toBeGreaterThanOrEqual(1);
      expect(sections[0].children[0].title).toContain('Section 1');

      // Section 1 has clauses 1.1 and 1.2
      expect(sections[0].children[0].children.length).toBe(2);
      expect(sections[0].children[0].children[0].title).toContain('1.1');
      expect(sections[0].children[0].children[1].title).toContain('1.2');

      // PART II has Sections 2 and 3
      expect(sections[1].children.length).toBe(2);
      expect(sections[1].children[0].title).toContain('Section 2');
      expect(sections[1].children[1].title).toContain('Section 3');

      // Section 2 has clauses 2.1, 2.2
      expect(sections[1].children[0].children.length).toBe(2);

      // Section 3 has clauses 3.1, 3.2
      expect(sections[1].children[1].children.length).toBe(2);
    });

    it('chunks sections with correct source metadata', () => {
      const sections = extractSections(FIRE_SAFETY_TEXT);
      const contentHash = computeHash(Buffer.from(FIRE_SAFETY_TEXT));
      const chunks = chunkDocument(sections, testSource, contentHash);

      expect(chunks.length).toBeGreaterThanOrEqual(1);

      for (const chunk of chunks) {
        expect(chunk.metadata.source_department).toBe('BD');
        expect(chunk.metadata.document_name).toBe('Code of Practice for Fire Safety in Buildings');
        expect(chunk.metadata.version).toBe('2011 (2024 Edition)');
        expect(chunk.metadata.document_type).toBe('code_of_practice');
        expect(chunk.metadata.is_current).toBe(true);
        expect(chunk.metadata.content_hash).toBe(contentHash);
        expect(chunk.metadata.ingested_at).toBeTruthy();
      }
    });

    it('preserves section hierarchy in chunk metadata', () => {
      const sections = extractSections(FIRE_SAFETY_TEXT);
      const chunks = chunkDocument(sections, testSource, 'hash');

      // At least some chunks should have multi-level hierarchy
      const deepChunks = chunks.filter(
        (c) => c.metadata.section_hierarchy.length >= 2
      );
      expect(deepChunks.length).toBeGreaterThan(0);
    });

    it('extracts cross-references from regulation text', () => {
      const sections = extractSections(FIRE_SAFETY_TEXT);
      const chunks = chunkDocument(sections, testSource, 'hash');

      const allRefs = chunks.flatMap((c) => c.metadata.cross_references);

      // Should find Cap. 123, Cap. 123F, PNAP ADV-33, Section 16(1), Section 17
      expect(allRefs.some((r) => r.includes('Cap. 123'))).toBe(true);
      expect(allRefs.some((r) => r.includes('PNAP ADV-33'))).toBe(true);
    });

    it('prepends contextual headers to chunk content', () => {
      const sections = extractSections(FIRE_SAFETY_TEXT);
      const chunks = chunkDocument(sections, testSource, 'hash');

      for (const chunk of chunks) {
        expect(chunk.content).toContain('[Source: Code of Practice for Fire Safety in Buildings (BD)');
        expect(chunk.content).toContain('[Location:');
      }
    });

    it('change detection identifies different document versions', () => {
      const v1 = Buffer.from('Version 1 of the fire safety code');
      const v2 = Buffer.from('Version 2 of the fire safety code with amendments');

      const hash1 = computeHash(v1);
      const hash2 = computeHash(v2);

      expect(hash1).not.toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('generates consistent hashes for identical content', () => {
      const content = Buffer.from(FIRE_SAFETY_TEXT);
      const hash1 = computeHash(content);
      const hash2 = computeHash(content);
      expect(hash1).toBe(hash2);
    });
  });

  describe('Cross-reference extraction from real regulatory text', () => {
    it('extracts Cap. references from Building Ordinance text', () => {
      const text = 'Under Cap. 123, all buildings must comply. See also Cap. 123F Section 17 and Cap. 572.';
      const refs = extractCrossReferences(text);
      expect(refs).toContain('Cap. 123');
      expect(refs).toContain('Cap. 123F');
      expect(refs).toContain('Cap. 572');
    });

    it('extracts PNAP references', () => {
      const text = 'Refer to PNAP ADV-33 and PNAP APP-152 for detailed guidance.';
      const refs = extractCrossReferences(text);
      expect(refs).toContain('PNAP ADV-33');
      expect(refs).toContain('PNAP APP-152');
    });

    it('extracts mixed reference types', () => {
      const text = 'As per Section 16(1) of Cap. 123 and PNAP ADV-33, Section 17.2 applies.';
      const refs = extractCrossReferences(text);
      expect(refs.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Plain text chunking fallback', () => {
    it('chunks text without section markers using paragraph splitting', () => {
      const plainText = Array.from({ length: 10 }, (_, i) =>
        `Paragraph ${i + 1}: This is regulatory text that discusses requirements ` +
        `for building compliance in Hong Kong under the Buildings Ordinance Cap. 123. ` +
        `The requirements specify minimum standards for structural integrity.`
      ).join('\n\n');

      const chunks = chunkPlainText(plainText, testSource, 'hash');
      expect(chunks.length).toBeGreaterThanOrEqual(1);

      for (const chunk of chunks) {
        expect(chunk.metadata.source_department).toBe('BD');
        expect(chunk.content).toContain('[Source:');
      }
    });
  });
});
