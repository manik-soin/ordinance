import { z } from 'zod';
import type pg from 'pg';
import type OpenAI from 'openai';
import { hybridSearch } from '../retrieval/hybrid-search.js';
import { rerank } from '../retrieval/reranker.js';
import { verifyCitations } from '../safety/citation-verifier.js';
import { extractCitations } from '../generator/index.js';
import type { SearchResult, SearchFilter } from '../retrieval/hybrid-search.js';
import {
  fetchFireDoorsets,
  fetchFireGlazing,
  fetchFireStopMaterials,
  fetchMiCSystems,
  fetchFireSafetyCompliance,
} from '../api/gov-data.js';
import type { Scratchpad, ChunkPointer } from './scratchpad.js';

/**
 * The agent's four tools. Each has a tight Zod schema and a description that
 * says WHEN to use it (and when not to) — the tool menu is part of the prompt,
 * so the "when" is what the model actually needs.
 *
 * Tool results are compact summaries with chunk pointers; full chunk text is
 * written to the scratchpad's chunk store, never pasted into observations
 * except through the explicit fetch-on-demand path (`retrieve.chunk_ids`).
 */

export interface ToolContext {
  pool: pg.Pool;
  scratchpad: Scratchpad;
}

export interface AgentTool {
  name: string;
  description: string;
  schema: z.ZodType;
  execute(args: unknown, ctx: ToolContext): Promise<string>;
}

const FULL_CHUNK_CHARS = 1600;

function renderPointer(p: ChunkPointer, index: number): string {
  const section = p.section || '(no section)';
  return `#${index + 1} [${p.chunkId.slice(0, 8)}] ${p.document} (${p.department}, ${p.version}) — ${section} — p.${p.page}\n   ${p.snippet}`;
}

// ─── retrieve ─────────────────────────────────────────────────────────────────

const retrieveSchema = z.object({
  query: z
    .string()
    .min(3)
    .max(300)
    .optional()
    .describe('Search query composed for this step — be specific, include clause numbers or technical terms when known. Required unless chunk_ids is given.'),
  department: z.enum(['BD', 'FSD', 'EPD', 'EMSD', 'HA']).optional().describe('Restrict to one department only when confident'),
  documentType: z
    .enum(['code_of_practice', 'design_manual', 'practice_note', 'circular_letter', 'ordinance'])
    .optional(),
  topK: z.number().int().min(1).max(8).optional().describe('Results to return (default 5)'),
  chunk_ids: z
    .array(z.string().min(4).max(64))
    .max(3)
    .optional()
    .describe('Fetch-on-demand: re-read the FULL text of up to 3 previously retrieved chunks by their [id] prefix instead of searching'),
});

export const retrieveTool: AgentTool = {
  name: 'retrieve',
  description:
    'Search the indexed HK regulation corpus (hybrid vector + keyword with reranking). Use for any question answerable from ingested codes, PNAPs, and ordinances — this is your primary tool and can be called multiple times with different queries. Pass chunk_ids to re-read the full text of chunks you already found. Do NOT use it for live approved-product lists (use gov_lookup) or for following an explicit clause cross-reference (use resolve_reference).',
  schema: retrieveSchema,
  async execute(args, ctx): Promise<string> {
    const parsed = retrieveSchema.parse(args);

    // Fetch-on-demand path: return full text for known chunk ids.
    if (parsed.chunk_ids && parsed.chunk_ids.length > 0) {
      const blocks: string[] = [];
      for (const idPrefix of parsed.chunk_ids) {
        const match = ctx.scratchpad
          .getAllChunks()
          .find((c) => c.id === idPrefix || c.id.startsWith(idPrefix));
        if (!match) {
          blocks.push(`[${idPrefix}] not found in chunk store — retrieve it first.`);
          continue;
        }
        const content =
          match.content.length > FULL_CHUNK_CHARS
            ? `${match.content.slice(0, FULL_CHUNK_CHARS)}... [truncated]`
            : match.content;
        blocks.push(
          `FULL TEXT [${match.id.slice(0, 8)}] ${match.document_name} (${match.source_department}, ${match.version}) — ${match.section_hierarchy.join(' > ')}:\n${content}`
        );
      }
      return blocks.join('\n\n');
    }

    if (!parsed.query) {
      return 'TOOL ERROR (retrieve): provide a query (to search) or chunk_ids (to re-read full text).';
    }

    const filter: SearchFilter = {};
    if (parsed.department) filter.department = parsed.department;
    if (parsed.documentType) filter.documentType = parsed.documentType;
    const topK = parsed.topK ?? 5;

    const candidates = await hybridSearch(ctx.pool, parsed.query, {
      filter,
      topK: topK * 2,
    });
    // Guard the reranker against empty candidate lists (Cohere 400s on them).
    const results =
      candidates.length > 0 ? await rerank(parsed.query, candidates, { topK }) : [];

    if (results.length === 0) {
      return `No results for "${parsed.query}". Do NOT retry a similar query — change strategy: use resolve_reference for clause/Part/Cap references, drop filters, or use much broader terms.`;
    }

    const pointers = ctx.scratchpad.addChunks(results);
    return `Retrieved ${results.length} chunk(s) for "${parsed.query}":\n${pointers
      .map((p, i) => renderPointer(p, i))
      .join('\n')}`;
  },
};

// ─── gov_lookup ───────────────────────────────────────────────────────────────

const govLookupSchema = z.object({
  dataset: z
    .enum(['fire_doorsets', 'fire_glazing', 'fire_stop_materials', 'mic_systems', 'fire_safety_compliance'])
    .describe('Which live data.gov.hk dataset to query'),
  search: z.string().max(80).optional().describe('Case-insensitive filter across all fields (e.g. a product or manufacturer name)'),
  limit: z.number().int().min(1).max(10).optional().describe('Max rows to return (default 5)'),
});

type GovRow = Record<string, string>;

async function fetchDataset(dataset: string): Promise<GovRow[]> {
  switch (dataset) {
    case 'fire_doorsets':
      return (await fetchFireDoorsets()) as unknown as GovRow[];
    case 'fire_glazing':
      return (await fetchFireGlazing()) as unknown as GovRow[];
    case 'fire_stop_materials':
      return (await fetchFireStopMaterials()) as unknown as GovRow[];
    case 'mic_systems':
      return (await fetchMiCSystems()) as unknown as GovRow[];
    case 'fire_safety_compliance':
      return (await fetchFireSafetyCompliance()) as unknown as GovRow[];
    default:
      return [];
  }
}

function renderGovRow(dataset: string, row: GovRow): string {
  switch (dataset) {
    case 'fire_doorsets':
      return `${row.refNo} ${row.productName} (${row.manufacturer}) — integrity ${row.integrityMinutes}min / insulation ${row.insulationMinutes}min — valid until ${row.validityDate}`;
    case 'fire_glazing':
      return `${row.refNo} ${row.productName} (${row.manufacturer}) — integrity ${row.integrityMinutes}min / insulation ${row.insulationMinutes}min`;
    case 'fire_stop_materials':
      return `${row.refNo} ${row.productName} (${row.manufacturer}) — ${row.category}; ${row.application}`;
    case 'mic_systems':
      return `${row.ref} ${row.manufacturer} — ${row.type}, max ${row.maxStorey} storeys — accepted ${row.dateAccepted}`;
    case 'fire_safety_compliance':
      return `${row.type} as at ${row.asAt}: ${row.directionsIssued} directions issued, ${row.directionsComplied} complied`;
    default:
      return JSON.stringify(row);
  }
}

export const govLookupTool: AgentTool = {
  name: 'gov_lookup',
  description:
    'Query LIVE data.gov.hk datasets: BD-approved fire doorsets, fire glazing, fire stop materials, accepted MiC systems, and fire safety compliance statistics. Use ONLY when the answer depends on current approval status or live data (e.g. "is this fire door model still approved?"). Do NOT use it for regulation text — that lives in retrieve.',
  schema: govLookupSchema,
  async execute(args): Promise<string> {
    const parsed = govLookupSchema.parse(args);
    const limit = parsed.limit ?? 5;

    const rows = await fetchDataset(parsed.dataset);
    if (rows.length === 0) {
      return `Dataset ${parsed.dataset} returned no rows (source may be unreachable). Answer from indexed regulations and flag that live verification failed.`;
    }

    let filtered = rows;
    if (parsed.search) {
      const needle = parsed.search.toLowerCase();
      filtered = rows.filter((row) =>
        Object.values(row).some((v) => String(v).toLowerCase().includes(needle))
      );
    }

    const shown = filtered.slice(0, limit);
    const header = parsed.search
      ? `gov_lookup ${parsed.dataset}: ${filtered.length}/${rows.length} rows match "${parsed.search}" (showing ${shown.length})`
      : `gov_lookup ${parsed.dataset}: ${rows.length} rows total (showing ${shown.length})`;

    if (shown.length === 0) {
      return `${header}. No match — the item may not be on the current approved list. State that explicitly rather than guessing.`;
    }

    return `${header}:\n${shown.map((r) => `- ${renderGovRow(parsed.dataset, r)}`).join('\n')}`;
  },
};

// ─── resolve_reference ────────────────────────────────────────────────────────

const resolveReferenceSchema = z.object({
  reference: z
    .string()
    .min(2)
    .max(120)
    .describe('The cross-reference exactly as it appears, e.g. "Part IV", "Section 4.3.2", "Clause 5.1", "Cap. 123F", "PNAP ADV-33"'),
  within_document: z
    .string()
    .max(160)
    .optional()
    .describe('Optional: restrict to a document name when the reference is internal to it'),
});

/** Build FTS-safe search patterns from a raw reference string. */
export function referencePatterns(reference: string): string[] {
  const patterns: string[] = [];

  const capMatch = reference.match(/Cap\.?\s*(\d+[A-Z]?)/i);
  if (capMatch) patterns.push(`Cap. ${capMatch[1]}`, `Cap ${capMatch[1]}`);

  const pnapMatch = reference.match(/PNAP\s+([A-Z]+-?\d+)/i);
  if (pnapMatch) patterns.push(`PNAP ${pnapMatch[1].toUpperCase()}`);

  const sectionMatch = reference.match(/Section\s+([\d.]+[A-Za-z]?)/i);
  if (sectionMatch) patterns.push(`Section ${sectionMatch[1]}`);

  const clauseMatch = reference.match(/Clause\s+([\d.]+[A-Za-z]?)/i);
  if (clauseMatch) patterns.push(`Clause ${clauseMatch[1]}`);

  const partMatch = reference.match(/Part\s+([IVXLC]+|\d+)/i);
  if (partMatch) patterns.push(`Part ${partMatch[1].toUpperCase()}`);

  const scheduleMatch = reference.match(/Schedule\s+(\d+|[IVX]+)/i);
  if (scheduleMatch) patterns.push(`Schedule ${scheduleMatch[1]}`);

  return patterns;
}

export const resolveReferenceTool: AgentTool = {
  name: 'resolve_reference',
  description:
    'Fetch the exact regulatory text a cross-reference points to — the second hop when a retrieved chunk says "subject to Part IV" or cites "Cap. 123F" / "PNAP ADV-33" / "Section 4.3.2". Use it with the reference string as written. Do NOT use it for general topical search (use retrieve).',
  schema: resolveReferenceSchema,
  async execute(args, ctx): Promise<string> {
    const parsed = resolveReferenceSchema.parse(args);
    const patterns = referencePatterns(parsed.reference);

    let rows: Record<string, unknown>[] = [];

    if (patterns.length > 0) {
      // Phrase-match each pattern; tokens sanitized for to_tsquery syntax
      // (tsvector lexemes drop punctuation anyway, so "Cap." matches as "cap").
      const tsQuery = patterns
        .map((p) =>
          p
            .split(/\s+/)
            .map((token) => token.replace(/[^\w-]/g, ''))
            .filter((token) => token.length > 0)
            .join(' <-> ')
        )
        .filter((p) => p.length > 0)
        .map((p) => `(${p})`)
        .join(' | ');
      const params: unknown[] = [tsQuery];
      let docClause = '';
      if (parsed.within_document) {
        params.push(`%${parsed.within_document}%`);
        docClause = 'AND document_name ILIKE $2';
      }
      const result = await ctx.pool.query(
        `SELECT id, content, source_department, document_type, document_name,
                version, section_hierarchy, page_number, cross_references,
                ts_rank_cd(search_vector, to_tsquery('english', $1)) AS score
         FROM regulation_chunks
         WHERE search_vector @@ to_tsquery('english', $1)
           AND is_current = true ${docClause}
         ORDER BY score DESC
         LIMIT 3`,
        params
      );
      rows = result.rows;
    }

    // Fallback: plain-text search on the raw reference.
    if (rows.length === 0) {
      const params: unknown[] = [parsed.reference];
      let docClause = '';
      if (parsed.within_document) {
        params.push(`%${parsed.within_document}%`);
        docClause = 'AND document_name ILIKE $2';
      }
      const result = await ctx.pool.query(
        `SELECT id, content, source_department, document_type, document_name,
                version, section_hierarchy, page_number, cross_references,
                ts_rank_cd(search_vector, plainto_tsquery('english', $1)) AS score
         FROM regulation_chunks
         WHERE search_vector @@ plainto_tsquery('english', $1)
           AND is_current = true ${docClause}
         ORDER BY score DESC
         LIMIT 3`,
        params
      );
      rows = result.rows;
    }

    if (rows.length === 0) {
      return `Could not resolve "${parsed.reference}" in the corpus. The referenced document may not be ingested — say so rather than inventing its content.`;
    }

    const results: SearchResult[] = rows.map((row) => ({
      id: row.id as string,
      content: row.content as string,
      score: row.score as number,
      source_department: row.source_department as string,
      document_type: row.document_type as string,
      document_name: row.document_name as string,
      version: (row.version ?? '') as string,
      section_hierarchy: (row.section_hierarchy ?? []) as string[],
      page_number: (row.page_number ?? 0) as number,
      cross_references: (row.cross_references ?? []) as string[],
      search_method: 'keyword',
    }));

    const pointers = ctx.scratchpad.addChunks(results);
    return `Resolved "${parsed.reference}" to ${results.length} chunk(s):\n${pointers
      .map((p, i) => renderPointer(p, i))
      .join('\n')}`;
  },
};

// ─── verify_citation ──────────────────────────────────────────────────────────

const verifyCitationSchema = z.object({
  text: z
    .string()
    .min(10)
    .max(6000)
    .describe('Draft answer (or passage) containing [bracketed] citations to check against retrieved chunks'),
});

export const verifyCitationTool: AgentTool = {
  name: 'verify_citation',
  description:
    'Check the [bracketed] citations in a draft passage against everything retrieved so far, BEFORE committing to a final answer. Returns which citations verify and which are phantoms. Use it when unsure a citation is grounded; the same check runs again as the mandatory exit gate.',
  schema: verifyCitationSchema,
  async execute(args, ctx): Promise<string> {
    const parsed = verifyCitationSchema.parse(args);
    const chunks = ctx.scratchpad.getAllChunks();
    const citations = extractCitations(parsed.text, chunks);
    const verification = verifyCitations(parsed.text, citations, chunks);

    const lines = [
      `Citations: ${verification.verifiedCitations}/${verification.totalCitations} verified (accuracy ${verification.citationAccuracy.toFixed(2)})`,
    ];
    if (verification.phantomCitations.length > 0) {
      lines.push(
        `PHANTOM citations (no supporting retrieved text — fix or remove): ${verification.phantomCitations
          .map((c) => `[${c.document_name}, ${c.section}]`)
          .join('; ')}`
      );
    }
    if (verification.uncitedClaims.length > 0) {
      lines.push(
        `Uncited regulatory claims (add citations or soften): ${verification.uncitedClaims
          .slice(0, 3)
          .map((c) => `"${c.slice(0, 90)}"`)
          .join('; ')}`
      );
    }
    if (verification.phantomCitations.length === 0 && verification.uncitedClaims.length === 0) {
      lines.push('All citations grounded. Safe to finalize.');
    }
    return lines.join('\n');
  },
};

// ─── Registry ─────────────────────────────────────────────────────────────────

/** The lead agent's toolset. */
export const AGENT_TOOLS: AgentTool[] = [
  retrieveTool,
  govLookupTool,
  resolveReferenceTool,
  verifyCitationTool,
];

/** Subagents get a clean context and only the lookup tools. */
export const SUBAGENT_TOOLS: AgentTool[] = [retrieveTool, resolveReferenceTool];

/** Convert tools to the OpenAI chat-completions tool format. */
export function toOpenAITools(tools: AgentTool[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.schema) as Record<string, unknown>,
    },
  }));
}

/**
 * Execute a named tool with raw model-supplied arguments.
 * Validation failures and runtime errors become observations, not crashes —
 * the recovery path is feeding the error back to the model.
 */
export async function executeTool(
  tools: AgentTool[],
  name: string,
  rawArgs: unknown,
  ctx: ToolContext
): Promise<{ ok: boolean; observation: string }> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    return {
      ok: false,
      observation: `TOOL ERROR: unknown tool "${name}". Available: ${tools.map((t) => t.name).join(', ')}.`,
    };
  }

  const validated = tool.schema.safeParse(rawArgs);
  if (!validated.success) {
    const issue = validated.error.issues[0];
    return {
      ok: false,
      observation: `TOOL ERROR (${name}): invalid arguments — ${issue?.path.join('.')} ${issue?.message}. Fix the arguments and retry.`,
    };
  }

  try {
    const observation = await tool.execute(validated.data, ctx);
    return { ok: true, observation };
  } catch (err) {
    // Log the real error server-side; return a generic, non-leaking message.
    // Raw DB/OpenAI/Cohere error text (schema names, internal detail) must not
    // reach the client-visible step trace, and the model recovers fine without it.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[agent] tool "${name}" failed:`, message);
    return {
      ok: false,
      observation: `TOOL ERROR (${name}): the tool failed due to an internal error. Try a different approach or answer from what you already have.`,
    };
  }
}
