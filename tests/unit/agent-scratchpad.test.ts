import { describe, it, expect } from 'vitest';
import { Scratchpad, toChunkPointer } from '../../src/agent/scratchpad.js';
import type { SearchResult } from '../../src/retrieval/hybrid-search.js';

function chunk(id: string, overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id,
    content: 'The fire resistance rating shall be not less than 120 minutes.',
    score: 0.9,
    source_department: 'BD',
    document_type: 'code_of_practice',
    document_name: 'Code of Practice for Fire Safety in Buildings 2011',
    version: '2011',
    section_hierarchy: ['Part C', 'Section 4.1'],
    page_number: 12,
    cross_references: [],
    search_method: 'hybrid',
    ...overrides,
  };
}

describe('scratchpad', () => {
  it('compacts chunks into pointers with truncated snippets', () => {
    const long = chunk('c1', { content: 'x'.repeat(1000) });
    const pointer = toChunkPointer(long);
    expect(pointer.snippet.length).toBeLessThanOrEqual(353);
    expect(pointer.snippet.endsWith('...')).toBe(true);
    expect(pointer.chunkId).toBe('c1');
    expect(pointer.section).toBe('Part C > Section 4.1');
  });

  it('stores full chunks and deduplicates by id', () => {
    const pad = new Scratchpad('objective');
    pad.addChunks([chunk('c1'), chunk('c2')]);
    pad.addChunks([chunk('c1'), chunk('c3')]);
    expect(pad.chunkCount()).toBe(3);
    expect(pad.getChunk('c1')?.content).toContain('fire resistance');
  });

  it('truncates oversized observations', () => {
    const pad = new Scratchpad('objective');
    pad.addObservation(1, 'retrieve', 'y'.repeat(9000));
    const obs = pad.getObservations()[0];
    expect(obs.summary.length).toBeLessThan(5300);
    expect(obs.summary).toContain('[truncated]');
  });

  it('renders objective, todo state, and recent observations', () => {
    const pad = new Scratchpad('Answer the fire door question');
    pad.setTodos(['retrieve regulations', 'check live data']);
    pad.completeTodo(0);
    pad.addObservation(1, 'retrieve', 'found 3 chunks');
    pad.addChunks([chunk('c1')]);

    const rendered = pad.renderForPrompt();
    expect(rendered).toContain('OBJECTIVE: Answer the fire door question');
    expect(rendered).toContain('- [x] retrieve regulations');
    expect(rendered).toContain('- [ ] check live data');
    expect(rendered).toContain('[step 1] retrieve: found 3 chunks');
    expect(rendered).toContain('CHUNK STORE: 1 retrieved chunk(s)');
  });

  it('collapses older observations beyond the recent window', () => {
    const pad = new Scratchpad('objective');
    for (let i = 1; i <= 9; i++) {
      pad.addObservation(i, `tool${i}`, `observation ${i}`);
    }
    const rendered = pad.renderForPrompt();
    // First three collapse into a one-line ledger; last six are shown in full.
    expect(rendered).toContain('steps 1-3 summarized');
    expect(rendered).not.toContain('observation 1');
    expect(rendered).toContain('observation 4');
    expect(rendered).toContain('observation 9');
  });
});
