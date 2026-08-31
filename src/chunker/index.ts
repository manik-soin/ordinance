import type { RegulationSource } from '../sources/buildings-dept.js';
import type { ParsedSection } from '../parser/index.js';

export interface ChunkMetadata {
  source_department: string;
  document_type: string;
  document_name: string;
  version: string;
  effective_date?: string;
  section_hierarchy: string[];
  page_number: number;
  is_current: boolean;
  cross_references: string[];
  content_hash: string;
  ingested_at: string;
}

export interface Chunk {
  content: string;
  metadata: ChunkMetadata;
}

export interface ChunkerOptions {
  minTokens: number;
  maxTokens: number;
  overlapTokens: number;
}

const DEFAULT_OPTIONS: ChunkerOptions = {
  minTokens: 256,
  maxTokens: 512,
  overlapTokens: 75,
};

/**
 * Approximate token count (1 token ≈ 4 chars for English text).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Structure-aware chunking for regulatory text.
 *
 * Strategy:
 * 1. Split by section boundaries (Part > Section > Clause)
 * 2. Enforce min/max token limits (merge small, split large)
 * 3. Add overlap at boundaries
 * 4. Prepend context header from parent section hierarchy
 * 5. Attach source metadata
 */
export function chunkDocument(
  sections: ParsedSection[],
  source: RegulationSource,
  contentHash: string,
  options: Partial<ChunkerOptions> = {}
): Chunk[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const flatChunks = flattenSections(sections, []);
  const sizedChunks = enforceSizeLimits(flatChunks, opts);
  const overlapped = addOverlap(sizedChunks, opts.overlapTokens);

  return overlapped.map((raw) => ({
    content: buildContextualContent(raw.text, raw.hierarchy, source),
    metadata: {
      source_department: source.department,
      document_type: source.type,
      document_name: source.name,
      version: source.version,
      section_hierarchy: raw.hierarchy,
      page_number: raw.pageNumber,
      is_current: true,
      cross_references: extractCrossReferences(raw.text),
      content_hash: contentHash,
      ingested_at: new Date().toISOString(),
    },
  }));
}

interface RawChunk {
  text: string;
  hierarchy: string[];
  pageNumber: number;
}

/**
 * Flatten nested sections into a flat list with hierarchy paths.
 */
function flattenSections(sections: ParsedSection[], parentHierarchy: string[]): RawChunk[] {
  const result: RawChunk[] = [];

  for (const section of sections) {
    const hierarchy = [...parentHierarchy, section.title];

    if (section.content.trim().length > 0) {
      result.push({
        text: section.content,
        hierarchy,
        pageNumber: section.pageNumber,
      });
    }

    if (section.children.length > 0) {
      result.push(...flattenSections(section.children, hierarchy));
    }
  }

  return result;
}

/**
 * Enforce minimum and maximum token limits.
 * Merge chunks that are too small, split chunks that are too large.
 */
function enforceSizeLimits(chunks: RawChunk[], opts: ChunkerOptions): RawChunk[] {
  const result: RawChunk[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const tokens = estimateTokens(chunk.text);

    if (tokens > opts.maxTokens) {
      // Split by paragraphs
      result.push(...splitByParagraphs(chunk, opts));
    } else if (tokens < opts.minTokens && result.length > 0) {
      // Merge with previous chunk if possible
      const prev = result[result.length - 1];
      const mergedTokens = estimateTokens(prev.text) + tokens;
      if (mergedTokens <= opts.maxTokens) {
        prev.text = prev.text + '\n\n' + chunk.text;
      } else {
        result.push(chunk);
      }
    } else {
      result.push(chunk);
    }
  }

  return result;
}

/**
 * Split a large chunk by paragraphs while respecting max token limit.
 */
function splitByParagraphs(chunk: RawChunk, opts: ChunkerOptions): RawChunk[] {
  const paragraphs = chunk.text.split(/\n\s*\n/);
  const result: RawChunk[] = [];
  let buffer = '';

  for (const para of paragraphs) {
    const combined = buffer ? buffer + '\n\n' + para : para;
    if (estimateTokens(combined) > opts.maxTokens && buffer) {
      result.push({ text: buffer, hierarchy: chunk.hierarchy, pageNumber: chunk.pageNumber });
      buffer = para;
    } else {
      buffer = combined;
    }
  }

  if (buffer) {
    result.push({ text: buffer, hierarchy: chunk.hierarchy, pageNumber: chunk.pageNumber });
  }

  return result;
}

/**
 * Add overlap tokens from previous chunk as prefix.
 */
function addOverlap(chunks: RawChunk[], overlapTokens: number): RawChunk[] {
  if (chunks.length <= 1) return chunks;

  const overlapChars = overlapTokens * 4;

  return chunks.map((chunk, i) => {
    if (i === 0) return chunk;

    const prevText = chunks[i - 1].text;
    const overlap = prevText.slice(-overlapChars);

    return {
      ...chunk,
      text: `...${overlap}\n\n${chunk.text}`,
    };
  });
}

/**
 * Prepend contextual header with section hierarchy and source info.
 * Uses Anthropic-style contextual chunking: a rich semantic prefix that helps
 * the embedding model understand the chunk's role in the broader regulation.
 */
function buildContextualContent(
  text: string,
  hierarchy: string[],
  source: RegulationSource
): string {
  const hierarchyStr = hierarchy.join(' > ');
  const contextParts: string[] = [];

  // Document-level context
  contextParts.push(`This is from ${source.name} (${source.department}), ${source.version}.`);

  // Section-level context
  if (hierarchy.length > 0) {
    const location = hierarchy.join(', under ');
    contextParts.push(`It appears in ${location}.`);
  }

  // Department-level context for embedding enrichment
  const deptContext = DEPARTMENT_CONTEXT[source.department];
  if (deptContext) {
    contextParts.push(deptContext);
  }

  const contextPrefix = contextParts.join(' ');

  return `${contextPrefix}\n\n[Source: ${source.name} (${source.department}), ${source.version}]\n[Location: ${hierarchyStr}]\n\n${text}`;
}

/**
 * Department-level context for chunk enrichment.
 * Helps embeddings disambiguate between regulatory domains.
 */
const DEPARTMENT_CONTEXT: Record<string, string> = {
  BD: 'This document is issued by the Buildings Department and governs building design, construction, planning, and structural requirements in Hong Kong.',
  FSD: 'This document is issued by the Fire Services Department and covers fire safety installations, fire service requirements, and fire protection standards.',
  EPD: 'This document is issued by the Environmental Protection Department and addresses environmental impact, noise control, air quality, and waste management.',
  EMSD: 'This document is issued by the Electrical and Mechanical Services Department and covers electrical safety, lift/escalator installations, and gas safety.',
  HA: 'This document is from the Hong Kong Housing Authority specifications for public housing design, construction, and building services.',
};

/**
 * Extract cross-references from text (Cap. numbers, PNAP refs, section refs).
 */
export function extractCrossReferences(text: string): string[] {
  const refs: string[] = [];

  // Cap. references: "Cap. 123", "Cap 123F"
  const capMatches = text.matchAll(/Cap\.?\s*(\d+[A-Z]?)/gi);
  for (const m of capMatches) {
    refs.push(`Cap. ${m[1]}`);
  }

  // PNAP references: "PNAP ADV-33", "PNAP APP-1"
  const pnapMatches = text.matchAll(/PNAP\s+([A-Z]+-\d+)/gi);
  for (const m of pnapMatches) {
    refs.push(`PNAP ${m[1]}`);
  }

  // Section references: "Section 17.2", "s.16(1)"
  const sectionMatches = text.matchAll(/(?:Section|s\.)\s*(\d+(?:\.\d+)?(?:\([^)]+\))?)/gi);
  for (const m of sectionMatches) {
    refs.push(`Section ${m[1]}`);
  }

  return [...new Set(refs)];
}

/**
 * Chunk plain text (non-sectioned) content with simple paragraph splitting.
 */
export function chunkPlainText(
  text: string,
  source: RegulationSource,
  contentHash: string,
  options: Partial<ChunkerOptions> = {}
): Chunk[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const rawChunks: RawChunk[] = [];
  let buffer = '';

  for (const para of paragraphs) {
    const combined = buffer ? buffer + '\n\n' + para : para;
    if (estimateTokens(combined) > opts.maxTokens && buffer) {
      rawChunks.push({ text: buffer, hierarchy: [], pageNumber: 1 });
      buffer = para;
    } else {
      buffer = combined;
    }
  }

  if (buffer) {
    rawChunks.push({ text: buffer, hierarchy: [], pageNumber: 1 });
  }

  const overlapped = addOverlap(rawChunks, opts.overlapTokens);

  return overlapped.map((raw) => ({
    content: buildContextualContent(raw.text, raw.hierarchy, source),
    metadata: {
      source_department: source.department,
      document_type: source.type,
      document_name: source.name,
      version: source.version,
      section_hierarchy: raw.hierarchy,
      page_number: raw.pageNumber,
      is_current: true,
      cross_references: extractCrossReferences(raw.text),
      content_hash: contentHash,
      ingested_at: new Date().toISOString(),
    },
  }));
}
