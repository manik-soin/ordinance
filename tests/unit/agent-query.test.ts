import { describe, it, expect, vi, beforeEach } from 'vitest';
import type OpenAI from 'openai';
import type pg from 'pg';
import type { SearchResult } from '../../src/retrieval/hybrid-search.js';

vi.mock('../../src/pipeline/query.js', () => ({
  queryPipeline: vi.fn(),
}));
vi.mock('../../src/db/store.js', () => ({
  logQueryAudit: vi.fn(async () => 'audit-123'),
}));
vi.mock('../../src/safety/faithfulness.js', () => ({
  scoreFaithfulness: vi.fn(),
}));
vi.mock('../../src/retrieval/hybrid-search.js', () => ({
  hybridSearch: vi.fn(),
}));
vi.mock('../../src/retrieval/reranker.js', () => ({
  rerank: vi.fn(),
}));

import { agentQuery } from '../../src/agent/index.js';
import { queryPipeline } from '../../src/pipeline/query.js';
import { scoreFaithfulness } from '../../src/safety/faithfulness.js';
import { logQueryAudit } from '../../src/db/store.js';
import { hybridSearch } from '../../src/retrieval/hybrid-search.js';
import { rerank } from '../../src/retrieval/reranker.js';

const DOC = 'Code of Practice for Fire Safety in Buildings 2011';

function chunk(id: string): SearchResult {
  return {
    id,
    content: 'The fire resistance rating shall be not less than 120 minutes. Section 4.1 applies.',
    score: 0.9,
    source_department: 'BD',
    document_type: 'code_of_practice',
    document_name: DOC,
    version: '2011',
    section_hierarchy: ['Part C', 'Section 4.1'],
    page_number: 12,
    cross_references: [],
    search_method: 'hybrid',
  };
}

function toolCallResponse(name: string, args: unknown) {
  return {
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            { id: 'tc-1', type: 'function', function: { name, arguments: JSON.stringify(args) } },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
  };
}

function finalResponse(text: string) {
  return {
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 80, completion_tokens: 40 },
  };
}

function makeClient() {
  const create = vi.fn();
  const client = { chat: { completions: { create } } } as unknown as OpenAI;
  return { client, create };
}

const pool = { query: vi.fn() } as unknown as pg.Pool;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('agentQuery', () => {
  it('delegates single-hop queries to the static pipeline', async () => {
    const { client, create } = makeClient();
    vi.mocked(queryPipeline).mockResolvedValue({
      answer: 'static answer',
      citations: [],
      sources: [],
      verification: { totalCitations: 0, verifiedCitations: 0, citationAccuracy: 1, phantomCitations: [], uncitedClaims: [] },
      faithfulness: { score: 9, reasoning: 'ok', flaggedClaims: [] },
      auditId: 'a1',
      latencyMs: 10,
      model: 'gpt-5.4',
    });

    const result = await agentQuery(pool, 'What is the minimum fire resistance period?', {
      client,
    });

    expect(result.path).toBe('static');
    expect(result.routeReasons).toEqual(['single-hop']);
    expect(result.answer).toBe('static answer');
    expect(queryPipeline).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it('runs the agent loop and passes the exit gate on a grounded answer', async () => {
    const { client, create } = makeClient();
    vi.mocked(hybridSearch).mockResolvedValue([chunk('c1')]);
    vi.mocked(rerank).mockImplementation(async (_q, r) => r);
    vi.mocked(scoreFaithfulness).mockResolvedValue({ score: 9, reasoning: 'grounded', flaggedClaims: [] });

    create
      .mockResolvedValueOnce(toolCallResponse('retrieve', { query: 'fire resistance rating' }))
      .mockResolvedValueOnce(finalResponse(`The rating is 120 minutes [${DOC} (BD), 2011, Section 4.1].`));

    const result = await agentQuery(pool, 'anything', { client, mode: 'agent' });

    expect(result.path).toBe('agent');
    expect(result.routeReasons).toEqual(['forced-agent']);
    expect(result.model).toBe('gpt-5.4+agent');
    expect(result.answer).toContain('120 minutes');
    expect(result.answer).toContain('Disclaimer');
    expect(result.trace?.steps).toHaveLength(1);
    expect(result.trace?.verificationRetries).toBe(0);
    expect(result.faithfulness.score).toBe(9);
    expect(result.sources.map((s) => s.id)).toEqual(['c1']);
    expect(result.auditId).toBe('audit-123');
    expect(vi.mocked(logQueryAudit).mock.calls[0][1].model).toBe('gpt-5.4+agent');
    // Agent answers are never cached.
    expect(result.cached).toBe(false);
  });

  it('retries once through the exit gate when faithfulness fails, then returns the corrected answer', async () => {
    const { client, create } = makeClient();
    vi.mocked(hybridSearch).mockResolvedValue([chunk('c1')]);
    vi.mocked(rerank).mockImplementation(async (_q, r) => r);
    vi.mocked(scoreFaithfulness)
      .mockResolvedValueOnce({ score: 3, reasoning: 'unsupported', flaggedClaims: ['made-up claim'] })
      .mockResolvedValueOnce({ score: 9, reasoning: 'fixed', flaggedClaims: [] });

    create
      .mockResolvedValueOnce(toolCallResponse('retrieve', { query: 'fire resistance rating' }))
      .mockResolvedValueOnce(finalResponse(`Draft with a shaky claim [${DOC} (BD), 2011, Section 4.1].`))
      .mockResolvedValueOnce(finalResponse(`Corrected answer [${DOC} (BD), 2011, Section 4.1].`));

    const result = await agentQuery(pool, 'anything', { client, mode: 'agent' });

    expect(result.trace?.verificationRetries).toBe(1);
    expect(result.answer).toContain('Corrected answer');
    expect(result.faithfulness.score).toBe(9);
    // The retry context carried the exit-gate failure back into the loop.
    const retryContext = create.mock.calls[2][0].messages[1].content as string;
    expect(retryContext).toContain('EXIT GATE FAILED');
    expect(retryContext).toContain('made-up claim');
  });

  it('pins extracted project memory and routes context-heavy queries to the agent', async () => {
    const { client, create } = makeClient();
    vi.mocked(scoreFaithfulness).mockResolvedValue({ score: 8, reasoning: 'ok', flaggedClaims: [] });
    create.mockResolvedValueOnce(finalResponse('Memory-aware answer.'));

    const result = await agentQuery(
      pool,
      'Does my 12-storey residential building meet the means-of-escape rules?',
      { client }
    );

    expect(result.path).toBe('agent');
    expect(result.routeReasons).toContain('context-dependent');
    expect(result.projectMemory).toEqual({ storeys: 12, buildingType: 'residential' });
    // The pinned memory is rendered into the working context.
    const context = create.mock.calls[0][0].messages[1].content as string;
    expect(context).toContain('PROJECT MEMORY');
    expect(context).toContain('storeys: 12');
  });

  it('merges caller-provided memory with newly extracted facts', async () => {
    const { client, create } = makeClient();
    vi.mocked(scoreFaithfulness).mockResolvedValue({ score: 8, reasoning: 'ok', flaggedClaims: [] });
    create.mockResolvedValueOnce(finalResponse('ok'));

    const result = await agentQuery(pool, 'Does this building need a sprinkler system?', {
      client,
      projectMemory: { storeys: 12, buildingType: 'residential' },
    });

    expect(result.path).toBe('agent');
    expect(result.projectMemory.storeys).toBe(12);
    expect(result.projectMemory.buildingType).toBe('residential');
  });
});
