import { describe, it, expect } from 'vitest';
import { makeHASource } from '../../src/sources/housing-authority.js';

describe('Barrel exports', () => {
  describe('src/retrieval/index.ts', () => {
    it('re-exports all retrieval functions', async () => {
      const mod = await import('../../src/retrieval/index.js');
      expect(mod.hybridSearch).toBeTypeOf('function');
      expect(mod.vectorSearch).toBeTypeOf('function');
      expect(mod.keywordSearch).toBeTypeOf('function');
      expect(mod.rrfFuse).toBeTypeOf('function');
      expect(mod.contextualizeFollowUpQuery).toBeTypeOf('function');
      expect(mod.expandQuery).toBeTypeOf('function');
      expect(mod.rerank).toBeTypeOf('function');
    });
  });

  describe('src/safety/index.ts', () => {
    it('re-exports all safety functions', async () => {
      const mod = await import('../../src/safety/index.js');
      expect(mod.validateQueryInput).toBeTypeOf('function');
      expect(mod.detectInjection).toBeTypeOf('function');
      expect(mod.sanitizeInput).toBeTypeOf('function');
      expect(mod.verifyCitations).toBeTypeOf('function');
      expect(mod.appendDisclaimer).toBeTypeOf('function');
      expect(mod.scoreFaithfulness).toBeTypeOf('function');
      expect(mod.queryInputSchema).toBeDefined();
    });
  });

  describe('makeHASource helper', () => {
    it('creates a valid RegulationSource for HA specs', () => {
      const source = makeHASource('Architectural Spec', 'https://ha.gov.hk/arch.pdf', 'Architectural');
      expect(source.name).toBe('Architectural Spec');
      expect(source.url).toBe('https://ha.gov.hk/arch.pdf');
      expect(source.department).toBe('HA');
      expect(source.type).toBe('code_of_practice');
      expect(source.category).toBe('Architectural');
      expect(source.version).toBe('current');
    });
  });

  describe('src/sources/index.ts', () => {
    it('re-exports all source definitions', async () => {
      const mod = await import('../../src/sources/index.js');
      expect(mod.BD_CODES_OF_PRACTICE).toBeInstanceOf(Array);
      expect(mod.BD_CODES_OF_PRACTICE.length).toBeGreaterThan(0);
      expect(mod.BD_PNAP_INDEX).toBeTypeOf('string');
      expect(mod.BD_BASE).toBeTypeOf('string');
      expect(mod.HA_SPEC_CATEGORIES).toBeDefined();
      expect(mod.HA_SPEC_INDEX).toBeTypeOf('string');
      expect(mod.LEGISLATION_SOURCES).toBeInstanceOf(Array);
      expect(mod.ELEGISLATION_BASE).toBeTypeOf('string');
    });
  });
});
