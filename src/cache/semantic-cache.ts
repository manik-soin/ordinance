/**
 * Semantic query cache — returns cached answers for similar queries.
 * Uses embedding cosine similarity at 95% threshold (from fwd learnings).
 * Cache hit: ~15ms vs ~8s full pipeline = 500x speedup.
 */

import type pg from 'pg';
import { embedQuery } from '../embedder/index.js';

const SIMILARITY_THRESHOLD = 0.95;
const TTL_SECONDS = 3600; // 1 hour

export interface CacheFilter {
  department?: string;
  documentType?: string;
  capNumber?: string;
  isCurrent?: boolean;
}

export interface CachedResponse {
  query: string;
  answer: string;
  citations: unknown;
  sources: unknown;
  cached_at: string;
}

interface CacheLookupOptions {
  queryEmbedding?: number[];
}

function normalizeQuery(query: string): string {
  return query
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function buildFilterKey(filter?: CacheFilter): string {
  return JSON.stringify({
    department: filter?.department ?? null,
    documentType: filter?.documentType ?? null,
    capNumber: filter?.capNumber ?? null,
    isCurrent: filter?.isCurrent ?? null,
  });
}

function mapCachedRow(row: Record<string, unknown>): CachedResponse {
  return {
    query: row.query as string,
    answer: row.answer as string,
    citations: row.citations,
    sources: row.sources,
    cached_at: row.cached_at as string,
  };
}

/**
 * Check if an identical normalized query has been cached recently.
 */
export async function checkExactCache(
  pool: pg.Pool,
  query: string,
  filter?: CacheFilter
): Promise<CachedResponse | null> {
  try {
    const normalizedQuery = normalizeQuery(query);
    const filterKey = buildFilterKey(filter);
    const { rows } = await pool.query(
      `SELECT query, answer, citations, sources, cached_at
       FROM query_cache
       WHERE normalized_query = $1
         AND filter_key = $2
         AND cached_at > NOW() - ($3 || ' seconds')::interval
       ORDER BY cached_at DESC
       LIMIT 1`,
      [normalizedQuery, filterKey, TTL_SECONDS]
    );

    return rows.length > 0 ? mapCachedRow(rows[0] as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Check if a semantically similar query has been cached recently.
 */
export async function checkSemanticCache(
  pool: pg.Pool,
  query: string,
  filter?: CacheFilter,
  options?: CacheLookupOptions
): Promise<CachedResponse | null> {
  try {
    const embedding = options?.queryEmbedding ?? await embedQuery(query);
    const embeddingStr = `[${embedding.join(',')}]`;
    const filterKey = buildFilterKey(filter);

    const sql = `
      SELECT query, answer, citations, sources, cached_at,
             1 - (query_embedding <=> $1::vector) AS similarity
      FROM query_cache
      WHERE 1 - (query_embedding <=> $1::vector) > $2
        AND filter_key = $3
        AND cached_at > NOW() - ($4 || ' seconds')::interval
      ORDER BY query_embedding <=> $1::vector
      LIMIT 1
    `;
    const params: unknown[] = [embeddingStr, SIMILARITY_THRESHOLD, filterKey, TTL_SECONDS];

    const { rows } = await pool.query(sql, params);

    return rows.length > 0 ? mapCachedRow(rows[0] as Record<string, unknown>) : null;
  } catch {
    // Cache miss on error — don't block the pipeline
    return null;
  }
}

/**
 * Store a query result in the cache.
 */
export async function writeCache(
  pool: pg.Pool,
  query: string,
  answer: string,
  citations: unknown,
  sources: unknown,
  filter?: CacheFilter,
  options?: CacheLookupOptions
): Promise<void> {
  try {
    const embedding = options?.queryEmbedding ?? await embedQuery(query);
    const embeddingStr = `[${embedding.join(',')}]`;
    const normalizedQuery = normalizeQuery(query);
    const filterKey = buildFilterKey(filter);
    const department = filter?.department ?? null;

    const updateResult = await pool.query(
      `UPDATE query_cache
       SET query = $1,
           query_embedding = $2::vector,
           answer = $3,
           citations = $4,
           sources = $5,
           department = $6,
           cached_at = NOW()
       WHERE normalized_query = $7
         AND filter_key = $8`,
      [
        query,
        embeddingStr,
        answer,
        JSON.stringify(citations),
        JSON.stringify(sources),
        department,
        normalizedQuery,
        filterKey,
      ]
    );

    if ((updateResult.rowCount ?? 0) > 0) {
      return;
    }

    await pool.query(
      `INSERT INTO query_cache (
         query,
         normalized_query,
         filter_key,
         query_embedding,
         answer,
         citations,
         sources,
         department,
         cached_at
       )
       VALUES ($1, $2, $3, $4::vector, $5, $6, $7, $8, NOW())`,
      [
        query,
        normalizedQuery,
        filterKey,
        embeddingStr,
        answer,
        JSON.stringify(citations),
        JSON.stringify(sources),
        department,
      ]
    );
  } catch {
    // Cache write failure is non-fatal
  }
}

/**
 * Create the query_cache table if it doesn't exist.
 */
export async function ensureCacheTable(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS query_cache (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      query TEXT NOT NULL,
      normalized_query TEXT,
      filter_key TEXT,
      query_embedding VECTOR(3072),
      answer TEXT NOT NULL,
      citations JSONB,
      sources JSONB,
      department TEXT,
      cached_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Index for similarity search (ignore error if exists)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_query_cache_embedding
    ON query_cache USING hnsw (query_embedding vector_cosine_ops)
  `).catch(() => {});

  await pool.query(`
    ALTER TABLE query_cache
    ADD COLUMN IF NOT EXISTS normalized_query TEXT
  `);

  await pool.query(`
    ALTER TABLE query_cache
    ADD COLUMN IF NOT EXISTS filter_key TEXT
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_query_cache_exact_lookup
    ON query_cache (normalized_query, filter_key, cached_at DESC)
  `).catch(() => {});
}
