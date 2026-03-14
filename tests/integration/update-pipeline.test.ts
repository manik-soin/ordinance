import { describe, it, expect } from 'vitest';
import { computeHash } from '../../src/scraper/index.js';
import { BD_CODES_OF_PRACTICE } from '../../src/sources/buildings-dept.js';
import { LEGISLATION_SOURCES } from '../../src/sources/e-legislation.js';
import { HA_SPEC_CATEGORIES } from '../../src/sources/housing-authority.js';

/**
 * Integration tests for the update/change detection pipeline.
 * Tests source definitions, hash-based change detection, and version tracking logic.
 */

describe('Update Pipeline (integration)', () => {
  describe('Source Catalog Completeness', () => {
    it('BD Codes of Practice covers all major structural and safety codes', () => {
      const names = BD_CODES_OF_PRACTICE.map((s) => s.name);

      // Must-have codes
      expect(names).toContain('Code of Practice for Fire Safety in Buildings');
      expect(names).toContain('Code of Practice for Structural Use of Concrete');
      expect(names).toContain('Code of Practice for Structural Use of Steel');
      expect(names).toContain('Code of Practice for Foundations');
      expect(names).toContain('Code of Practice on Wind Effects');
      expect(names).toContain('Code of Practice for Site Supervision');
      expect(names).toContain('Design Manual - Barrier Free Access');
    });

    it('all BD sources have valid PDF URLs', () => {
      for (const source of BD_CODES_OF_PRACTICE) {
        expect(source.url).toMatch(/^https:\/\/www\.bd\.gov\.hk\/.+\.pdf$/);
        expect(source.department).toBe('BD');
        expect(source.version).toBeTruthy();
      }
    });

    it('e-Legislation covers all key building-related ordinances', () => {
      const caps = LEGISLATION_SOURCES.map((s) => s.cap);

      expect(caps).toContain('123');   // Buildings Ordinance
      expect(caps).toContain('123A');  // Admin Regulations
      expect(caps).toContain('123B');  // Construction Regulations
      expect(caps).toContain('123F');  // Planning Regulations
      expect(caps).toContain('572');   // Fire Safety (Buildings)
      expect(caps).toContain('502');   // Fire Safety (Commercial Premises)
      expect(caps).toContain('400');   // Noise Control
      expect(caps).toContain('499');   // EIA
      expect(caps).toContain('618');   // Lifts and Escalators
    });

    it('e-Legislation URLs follow correct pattern', () => {
      for (const source of LEGISLATION_SOURCES) {
        expect(source.url).toContain('elegislation.gov.hk');
        expect(source.url).toContain(`cap${source.cap}`);
      }
    });

    it('HA specification categories cover all 10 disciplines', () => {
      expect(HA_SPEC_CATEGORIES).toHaveLength(10);
      expect(HA_SPEC_CATEGORIES).toContain('Architectural');
      expect(HA_SPEC_CATEGORIES).toContain('Structural Engineering');
      expect(HA_SPEC_CATEGORIES).toContain('Building Services');
      expect(HA_SPEC_CATEGORIES).toContain('Geotechnical Engineering');
    });

    it('all departments are represented across sources', () => {
      const bdDepts = BD_CODES_OF_PRACTICE.map((s) => s.department);
      const legDepts = LEGISLATION_SOURCES.map((s) => s.department);

      const allDepts = new Set([...bdDepts, ...legDepts]);
      expect(allDepts).toContain('BD');
      expect(allDepts).toContain('FSD');
      expect(allDepts).toContain('EPD');
      expect(allDepts).toContain('EMSD');
    });
  });

  describe('Content hash change detection', () => {
    it('detects content changes across document versions', () => {
      const v1 = Buffer.from('Fire resistance period: 1 hour');
      const v2 = Buffer.from('Fire resistance period: 2 hours (amended 2024)');

      const hash1 = computeHash(v1);
      const hash2 = computeHash(v2);

      expect(hash1).not.toBe(hash2);
    });

    it('hash is stable for identical content', () => {
      const content = Buffer.from('Section 17.2 of Cap 123F: All buildings shall...');
      expect(computeHash(content)).toBe(computeHash(content));
    });

    it('hash changes for even small amendments', () => {
      const original = Buffer.from('The minimum width shall be 1050mm.');
      const amended = Buffer.from('The minimum width shall be 1050 mm.');

      expect(computeHash(original)).not.toBe(computeHash(amended));
    });

    it('produces 64-character hex string (SHA-256)', () => {
      const hash = computeHash(Buffer.from('any content'));
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('Source metadata consistency', () => {
    it('all BD codes have a category assigned', () => {
      for (const source of BD_CODES_OF_PRACTICE) {
        expect(source.category).toBeTruthy();
        expect(typeof source.category).toBe('string');
      }
    });

    it('BD codes cover essential categories', () => {
      const categories = new Set(BD_CODES_OF_PRACTICE.map((s) => s.category));
      expect(categories).toContain('fire_safety');
      expect(categories).toContain('structural');
      expect(categories).toContain('geotechnical');
      expect(categories).toContain('accessibility');
    });

    it('all sources have valid type enums', () => {
      const validTypes = ['code_of_practice', 'design_manual', 'practice_note', 'circular_letter', 'ordinance'];
      for (const source of BD_CODES_OF_PRACTICE) {
        expect(validTypes).toContain(source.type);
      }
    });
  });
});
