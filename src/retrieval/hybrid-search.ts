import type pg from 'pg';
import { embedQuery } from '../embedder/index.js';

export interface SearchFilter {
  department?: string;
  documentType?: string;
  capNumber?: string;
  isCurrent?: boolean;
}

export interface SearchResult {
  id: string;
  content: string;
  score: number;
  source_department: string;
  document_type: string;
  document_name: string;
  version: string;
  section_hierarchy: string[];
  page_number: number;
  cross_references: string[];
  search_method: 'vector' | 'keyword' | 'hybrid';
}

const RRF_K = 60;

/**
 * Hybrid search combining vector similarity + BM25 keyword search with RRF fusion.
 */
export async function hybridSearch(
  pool: pg.Pool,
  query: string,
  options?: {
    filter?: SearchFilter;
    vectorK?: number;
    keywordK?: number;
    topK?: number;
    queryEmbedding?: number[];
  }
): Promise<SearchResult[]> {
  const vectorK = options?.vectorK ?? 10;
  const keywordK = options?.keywordK ?? 10;
  const topK = options?.topK ?? 5;
  const filter = options?.filter ?? {};

  const [vectorResults, keywordResults] = await Promise.all([
    vectorSearch(pool, query, vectorK, filter, options?.queryEmbedding),
    keywordSearch(pool, query, keywordK, filter),
  ]);

  return rrfFuse(vectorResults, keywordResults, topK);
}

/**
 * Vector similarity search using pgvector cosine distance.
 */
export async function vectorSearch(
  pool: pg.Pool,
  query: string,
  k: number,
  filter: SearchFilter,
  precomputedEmbedding?: number[]
): Promise<SearchResult[]> {
  const embedding = precomputedEmbedding ?? await embedQuery(query);
  const { whereClause, params } = buildWhereClause(filter, 2);

  const embeddingStr = `[${embedding.join(',')}]`;
  const sql = `
    SELECT
      id, content, source_department, document_type, document_name,
      version, section_hierarchy, page_number, cross_references,
      1 - (embedding <=> $1::vector) AS score
    FROM regulation_chunks
    WHERE embedding IS NOT NULL ${whereClause}
    ORDER BY embedding <=> $1::vector
    LIMIT $${params.length + 2}
  `;

  const { rows } = await pool.query(sql, [embeddingStr, ...params, k]);

  return rows.map((row: Record<string, unknown>) => ({
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
    search_method: 'vector' as const,
  }));
}

/**
 * PostgreSQL full-text search (BM25-like keyword search).
 */
export async function keywordSearch(
  pool: pg.Pool,
  query: string,
  k: number,
  filter: SearchFilter
): Promise<SearchResult[]> {
  const { whereClause, params } = buildWhereClause(filter, 2);

  const sql = `
    SELECT
      id, content, source_department, document_type, document_name,
      version, section_hierarchy, page_number, cross_references,
      ts_rank_cd(search_vector, plainto_tsquery('english', $1)) AS score
    FROM regulation_chunks
    WHERE search_vector @@ plainto_tsquery('english', $1) ${whereClause}
    ORDER BY score DESC
    LIMIT $${params.length + 2}
  `;

  const { rows } = await pool.query(sql, [query, ...params, k]);

  return rows.map((row: Record<string, unknown>) => ({
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
    search_method: 'keyword' as const,
  }));
}

/**
 * Reciprocal Rank Fusion to merge vector and keyword results.
 */
export function rrfFuse(
  vectorResults: SearchResult[],
  keywordResults: SearchResult[],
  topK: number
): SearchResult[] {
  const scoreMap = new Map<string, { score: number; result: SearchResult }>();

  // Score vector results
  for (let rank = 0; rank < vectorResults.length; rank++) {
    const result = vectorResults[rank];
    const rrfScore = 1 / (RRF_K + rank + 1);
    const existing = scoreMap.get(result.id);
    if (existing) {
      existing.score += rrfScore;
      existing.result.search_method = 'hybrid';
    } else {
      scoreMap.set(result.id, { score: rrfScore, result: { ...result } });
    }
  }

  // Score keyword results
  for (let rank = 0; rank < keywordResults.length; rank++) {
    const result = keywordResults[rank];
    const rrfScore = 1 / (RRF_K + rank + 1);
    const existing = scoreMap.get(result.id);
    if (existing) {
      existing.score += rrfScore;
      existing.result.search_method = 'hybrid';
    } else {
      scoreMap.set(result.id, { score: rrfScore, result: { ...result } });
    }
  }

  return [...scoreMap.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ score, result }) => ({ ...result, score }));
}

/**
 * Build WHERE clause from filters.
 */
function buildWhereClause(
  filter: SearchFilter,
  startParam: number
): { whereClause: string; params: (string | boolean)[] } {
  const clauses: string[] = [];
  const params: (string | boolean)[] = [];
  let paramIdx = startParam;

  if (filter.department) {
    clauses.push(`AND source_department = $${paramIdx++}`);
    params.push(filter.department);
  }
  if (filter.documentType) {
    clauses.push(`AND document_type = $${paramIdx++}`);
    params.push(filter.documentType);
  }
  if (filter.capNumber) {
    clauses.push(`AND cap_number = $${paramIdx++}`);
    params.push(filter.capNumber);
  }
  if (filter.isCurrent !== undefined) {
    clauses.push(`AND is_current = $${paramIdx++}`);
    params.push(filter.isCurrent);
  } else {
    clauses.push('AND is_current = true');
  }

  return { whereClause: clauses.join(' '), params };
}
