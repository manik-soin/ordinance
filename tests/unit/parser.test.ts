import { describe, it, expect } from 'vitest';
import { extractSections } from '../../src/parser/index.js';

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
});
