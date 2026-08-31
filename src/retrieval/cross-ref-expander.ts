import type pg from 'pg';
import type { SearchResult } from './hybrid-search.js';

/**
 * Expand retrieval results by following cross-references.
 *
 * When retrieved chunks reference other regulations (Cap. numbers, PNAPs, Sections),
 * fetch related chunks from the database to provide complete context for generation.
 * This addresses multi-document questions where the answer spans multiple regulations.
 */
export async function expandCrossReferences(
  pool: pg.Pool,
  results: SearchResult[],
  options?: { maxExpansion?: number }
): Promise<SearchResult[]> {
  const maxExpansion = options?.maxExpansion ?? 3;

  // Collect all cross-references from retrieved chunks
  const allRefs = new Set<string>();
  const existingIds = new Set(results.map(r => r.id));

  for (const result of results) {
    for (const ref of result.cross_references) {
      allRefs.add(ref);
    }
  }

  if (allRefs.size === 0) return results;

  // Build search patterns from cross-references
  const refPatterns: string[] = [];
  for (const ref of allRefs) {
    // Cap. references: search for document_name containing the Cap number
    const capMatch = ref.match(/Cap\.\s*(\d+[A-Z]?)/i);
    if (capMatch) {
      refPatterns.push(`Cap. ${capMatch[1]}`);
      refPatterns.push(`Cap ${capMatch[1]}`);
    }

    // PNAP references: search for document containing PNAP code
    const pnapMatch = ref.match(/PNAP\s+([A-Z]+-\d+)/i);
    if (pnapMatch) {
      refPatterns.push(`PNAP ${pnapMatch[1]}`);
    }

    // Section references: search for section in content
    const sectionMatch = ref.match(/Section\s+([\d.]+)/i);
    if (sectionMatch) {
      refPatterns.push(`Section ${sectionMatch[1]}`);
    }
  }

  if (refPatterns.length === 0) return results;

  // Query for related chunks using full-text search on cross-reference patterns
  try {
    const searchTerms = refPatterns.slice(0, 5).join(' | ');
    const { rows } = await pool.query(
      `SELECT id, content, source_department, document_type, document_name,
              version, section_hierarchy, page_number, cross_references,
              ts_rank_cd(search_vector, to_tsquery('english', $1)) AS score
       FROM regulation_chunks
       WHERE search_vector @@ to_tsquery('english', $1)
         AND is_current = true
       ORDER BY score DESC
       LIMIT $2`,
      [searchTerms, maxExpansion + existingIds.size]
    );

    // Filter out chunks already in results and add as cross-ref expanded
    const expanded: SearchResult[] = [];
    for (const row of rows) {
      if (existingIds.has(row.id as string)) continue;
      if (expanded.length >= maxExpansion) break;

      expanded.push({
        id: row.id as string,
        content: row.content as string,
        score: (row.score as number) * 0.5, // Discount cross-ref results
        source_department: row.source_department as string,
        document_type: row.document_type as string,
        document_name: row.document_name as string,
        version: (row.version ?? '') as string,
        section_hierarchy: (row.section_hierarchy ?? []) as string[],
        page_number: (row.page_number ?? 0) as number,
        cross_references: (row.cross_references ?? []) as string[],
        search_method: 'hybrid',
      });
    }

    return [...results, ...expanded];
  } catch {
    // Non-fatal — return original results on error
    return results;
  }
}
