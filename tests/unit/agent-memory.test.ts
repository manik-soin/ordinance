import { describe, it, expect } from 'vitest';
import {
  extractProjectMemory,
  mergeProjectMemory,
  hasMemory,
  renderMemory,
} from '../../src/agent/memory.js';

describe('project memory', () => {
  it('extracts storey count from hyphenated and spaced forms', () => {
    expect(extractProjectMemory('my 12-storey building').storeys).toBe(12);
    expect(extractProjectMemory('a 30 storey tower').storeys).toBe(30);
    expect(extractProjectMemory('three storeys of retail').storeys).toBeUndefined();
  });

  it('extracts building type', () => {
    expect(extractProjectMemory('my residential building').buildingType).toBe('residential');
    expect(extractProjectMemory('a composite building in Mong Kok').buildingType).toBe('composite');
  });

  it('extracts use class and site area', () => {
    const memory = extractProjectMemory('use class 2 site of 1,200 m2');
    expect(memory.useClass).toBe('2');
    expect(memory.siteAreaSqm).toBe(1200);
  });

  it('merges with newest mention winning per field', () => {
    const prior = { storeys: 12, buildingType: 'residential' };
    const merged = mergeProjectMemory(prior, { storeys: 15 });
    expect(merged.storeys).toBe(15);
    expect(merged.buildingType).toBe('residential');
  });

  it('does not clobber prior facts with undefined', () => {
    const merged = mergeProjectMemory({ storeys: 12 }, {});
    expect(merged.storeys).toBe(12);
  });

  it('hasMemory reflects pinned facts', () => {
    expect(hasMemory(undefined)).toBe(false);
    expect(hasMemory({})).toBe(false);
    expect(hasMemory({ storeys: 5 })).toBe(true);
  });

  it('renders memory as a compact pinned block', () => {
    const rendered = renderMemory({ buildingType: 'residential', storeys: 12 });
    expect(rendered).toContain('PROJECT MEMORY');
    expect(rendered).toContain('building type: residential');
    expect(rendered).toContain('storeys: 12');
    expect(renderMemory({})).toBe('');
  });
});
