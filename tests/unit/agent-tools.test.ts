import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pg from 'pg';
import { Scratchpad } from '../../src/agent/scratchpad.js';
import type { SearchResult } from '../../src/retrieval/hybrid-search.js';

vi.mock('../../src/retrieval/hybrid-search.js', () => ({
  hybridSearch: vi.fn(),
}));
vi.mock('../../src/retrieval/reranker.js', () => ({
  rerank: vi.fn(),
}));
vi.mock('../../src/api/gov-data.js', () => ({
  fetchFireDoorsets: vi.fn(),
  fetchFireGlazing: vi.fn(),
  fetchFireStopMaterials: vi.fn(),
  fetchMiCSystems: vi.fn(),
  fetchFireSafetyCompliance: vi.fn(),
}));

import { hybridSearch } from '../../src/retrieval/hybrid-search.js';
import { rerank } from '../../src/retrieval/reranker.js';
import { fetchFireDoorsets } from '../../src/api/gov-data.js';
import {
  executeTool,
  AGENT_TOOLS,
  retrieveTool,
  govLookupTool,
  resolveReferenceTool,
  verifyCitationTool,
  referencePatterns,
  toOpenAITools,
} from '../../src/agent/tools.js';

function chunk(id: string, overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id,
    content:
      'The fire resistance rating shall be not less than 120 minutes for buildings exceeding 25 m in height. See Section 4.1.',
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

function makeCtx() {
  const queryMock = vi.fn();
  const pool = { query: queryMock } as unknown as pg.Pool;
  const scratchpad = new Scratchpad('test objective');
  return { pool, scratchpad, queryMock };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('executeTool', () => {
  it('returns an error observation for unknown tools', async () => {
    const result = await executeTool(AGENT_TOOLS, 'does_not_exist', {}, makeCtx());
    expect(result.ok).toBe(false);
    expect(result.observation).toContain('unknown tool');
    expect(result.observation).toContain('retrieve');
  });

  it('returns a validation error observation for bad arguments', async () => {
    const result = await executeTool(AGENT_TOOLS, 'retrieve', { query: 'x' }, makeCtx());
    expect(result.ok).toBe(false);
    expect(result.observation).toContain('TOOL ERROR (retrieve)');
    expect(result.observation).toContain('invalid arguments');
  });

  it('converts runtime tool errors into recoverable observations without leaking internals', async () => {
    vi.mocked(hybridSearch).mockRejectedValue(new Error('db unreachable at postgres://secret@host'));
    const result = await executeTool(
      AGENT_TOOLS,
      'retrieve',
      { query: 'fire resistance period' },
      makeCtx()
    );
    expect(result.ok).toBe(false);
    expect(result.observation).toContain('internal error');
    // The raw error text must not reach the client-visible observation.
    expect(result.observation).not.toContain('postgres://');
    expect(result.observation).not.toContain('db unreachable');
  });
});

describe('retrieve tool', () => {
  it('returns compact pointers and stores full chunks', async () => {
    const ctx = makeCtx();
    const results = [chunk('aaaa1111-0000'), chunk('bbbb2222-0000')];
    vi.mocked(hybridSearch).mockResolvedValue(results);
    vi.mocked(rerank).mockImplementation(async (_q, r, o) => r.slice(0, o?.topK ?? 5));

    const observation = await retrieveTool.execute(
      { query: 'fire resistance period structural elements' },
      ctx
    );

    expect(observation).toContain('Retrieved 2 chunk(s)');
    expect(observation).toContain('[aaaa1111]');
    expect(observation).toContain('Code of Practice for Fire Safety in Buildings 2011');
    expect(ctx.scratchpad.chunkCount()).toBe(2);
    // Progressive disclosure: full 500+ char chunks never enter the observation.
    expect(observation.length).toBeLessThan(1200);
  });

  it('suggests recovery when nothing is found', async () => {
    vi.mocked(hybridSearch).mockResolvedValue([]);
    vi.mocked(rerank).mockResolvedValue([]);
    const observation = await retrieveTool.execute({ query: 'nonexistent topic' }, makeCtx());
    expect(observation).toContain('No results');
    expect(observation).toContain('resolve_reference');
  });

  it('fetches full chunk text on demand by id prefix', async () => {
    const ctx = makeCtx();
    ctx.scratchpad.addChunks([chunk('aaaa1111-2222-3333', { content: 'FULL CHUNK BODY '.repeat(20) })]);

    const observation = await retrieveTool.execute(
      { query: 'placeholder', chunk_ids: ['aaaa1111', 'missing99'] },
      ctx
    );
    expect(observation).toContain('FULL TEXT [aaaa1111]');
    expect(observation).toContain('FULL CHUNK BODY');
    expect(observation).toContain('[missing99] not found');
    expect(hybridSearch).not.toHaveBeenCalled();
  });
});

describe('gov_lookup tool', () => {
  const rows = [
    {
      refNo: 'FD-001',
      productName: 'Fireshield FD-60',
      manufacturer: 'Chubb',
      integrityMinutes: '60',
      insulationMinutes: '60',
      testReport: 'TR-1',
      validityDate: '2027-01-01',
    },
    {
      refNo: 'FD-002',
      productName: 'SteelGuard 120',
      manufacturer: 'Hormann',
      integrityMinutes: '120',
      insulationMinutes: '120',
      testReport: 'TR-2',
      validityDate: '2026-11-30',
    },
  ];

  it('filters rows by search term and renders compact lines', async () => {
    vi.mocked(fetchFireDoorsets).mockResolvedValue(rows as never);
    const observation = await govLookupTool.execute(
      { dataset: 'fire_doorsets', search: 'fireshield' },
      makeCtx()
    );
    expect(observation).toContain('1/2 rows match "fireshield"');
    expect(observation).toContain('Fireshield FD-60 (Chubb)');
    expect(observation).not.toContain('SteelGuard');
  });

  it('states clearly when nothing matches the approved list', async () => {
    vi.mocked(fetchFireDoorsets).mockResolvedValue(rows as never);
    const observation = await govLookupTool.execute(
      { dataset: 'fire_doorsets', search: 'nonexistent-model' },
      makeCtx()
    );
    expect(observation).toContain('No match');
    expect(observation).toContain('rather than guessing');
  });

  it('degrades gracefully when the dataset is empty or unreachable', async () => {
    vi.mocked(fetchFireDoorsets).mockResolvedValue([] as never);
    const observation = await govLookupTool.execute({ dataset: 'fire_doorsets' }, makeCtx());
    expect(observation).toContain('no rows');
    expect(observation).toContain('flag that live verification failed');
  });
});

describe('resolve_reference tool', () => {
  it('extracts patterns from reference strings', () => {
    expect(referencePatterns('Cap. 123F')).toEqual(['Cap. 123F', 'Cap 123F']);
    expect(referencePatterns('PNAP ADV-33')).toEqual(['PNAP ADV-33']);
    expect(referencePatterns('Section 4.3.2')).toEqual(['Section 4.3.2']);
    expect(referencePatterns('Part IV')).toEqual(['Part IV']);
    expect(referencePatterns('Clause 5.1')).toEqual(['Clause 5.1']);
    expect(referencePatterns('something vague')).toEqual([]);
  });

  it('resolves references via phrase search and stores the chunks', async () => {
    const ctx = makeCtx();
    ctx.queryMock.mockResolvedValue({
      rows: [
        {
          id: 'ref-chunk-1',
          content: 'Part IV: Means of escape requirements...',
          source_department: 'BD',
          document_type: 'ordinance',
          document_name: 'Building (Planning) Regulations',
          version: '2023',
          section_hierarchy: ['Part IV'],
          page_number: 40,
          cross_references: [],
          score: 0.5,
        },
      ],
    });

    const observation = await resolveReferenceTool.execute({ reference: 'Part IV' }, ctx);
    expect(observation).toContain('Resolved "Part IV" to 1 chunk(s)');
    expect(observation).toContain('Building (Planning) Regulations');
    expect(ctx.scratchpad.chunkCount()).toBe(1);

    const [sql, params] = ctx.queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('to_tsquery');
    expect(params[0]).toBe('(Part <-> IV)');
  });

  it('falls back to plain-text search and reports unresolvable references', async () => {
    const ctx = makeCtx();
    ctx.queryMock.mockResolvedValue({ rows: [] });

    const observation = await resolveReferenceTool.execute(
      { reference: 'Section 99.99' },
      ctx
    );
    expect(observation).toContain('Could not resolve');
    expect(observation).toContain('rather than inventing');
    // Pattern search + plain-text fallback.
    expect(ctx.queryMock.mock.calls.length).toBe(2);
  });
});

describe('verify_citation tool', () => {
  it('confirms grounded citations', async () => {
    const ctx = makeCtx();
    ctx.scratchpad.addChunks([chunk('c1')]);
    const observation = await verifyCitationTool.execute(
      {
        text: 'The rating is 120 minutes [Code of Practice for Fire Safety in Buildings 2011 (BD), 2011, Section 4.1].',
      },
      ctx
    );
    expect(observation).toContain('1/1 verified');
    expect(observation).toContain('Safe to finalize');
  });

  it('flags uncited regulatory claims', async () => {
    const ctx = makeCtx();
    ctx.scratchpad.addChunks([chunk('c1')]);
    const observation = await verifyCitationTool.execute(
      {
        text: 'The fire resistance rating shall be not less than 120 minutes for all such buildings. This is a long uncited sentence with regulatory force.',
      },
      ctx
    );
    expect(observation).toContain('Uncited regulatory claims');
  });
});

describe('toOpenAITools', () => {
  it('produces valid OpenAI function specs with JSON-schema parameters', () => {
    const specs = toOpenAITools(AGENT_TOOLS);
    expect(specs).toHaveLength(4);
    const names = specs.map((s) => s.type === 'function' && s.function.name);
    expect(names).toEqual(['retrieve', 'gov_lookup', 'resolve_reference', 'verify_citation']);
    for (const spec of specs) {
      if (spec.type !== 'function') continue;
      expect(spec.function.description!.length).toBeGreaterThan(40);
      const params = spec.function.parameters as { type: string; properties: object };
      expect(params.type).toBe('object');
      expect(Object.keys(params.properties).length).toBeGreaterThan(0);
    }
  });
});
