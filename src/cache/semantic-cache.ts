/**
 * Semantic query cache — returns cached answers for similar queries.
 * Uses embedding cosine similarity at 95% threshold (from fwd learnings).
 * Cache hit: ~15ms vs ~8s full pipeline = 500x speedup.
 */

import type pg from 'pg';
import { embedQuery } from '../embedder/index.js';

const SIMILARITY_THRESHOLD = 0.95;
const TTL_SECONDS = 3600; // 1 hour

export interface CachedResponse {
  query: string;
  answer: string;
  citations: unknown;
  sources: unknown;
  cached_at: string;
}

/**
 * Check if a similar query has been cached recently.
 */
export async function checkCache(
  pool: pg.Pool,
  query: string,
  filter?: { department?: string }
): Promise<CachedResponse | null> {
  try {
    const embedding = await embedQuery(query);
    const embeddingStr = `[${embedding.join(',')}]`;
    const dept = filter?.department ?? null;

    const sql = `
      SELECT query, answer, citations, sources, cached_at,
             1 - (query_embedding <=> $1::vector) AS similarity
      FROM query_cache
      WHERE 1 - (query_embedding <=> $1::vector) > $2
        AND cached_at > NOW() - INTERVAL '${TTL_SECONDS} seconds'
        ${dept ? 'AND department = $4' : ''}
      ORDER BY query_embedding <=> $1::vector
      LIMIT 1
    `;
    const params: unknown[] = [embeddingStr, SIMILARITY_THRESHOLD, TTL_SECONDS];
    if (dept) params.push(dept);

    const { rows } = await pool.query(sql, params);

    if (rows.length > 0) {
      return {
        query: rows[0].query as string,
        answer: rows[0].answer as string,
        citations: rows[0].citations,
        sources: rows[0].sources,
        cached_at: rows[0].cached_at as string,
      };
    }
    return null;
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
  department?: string
): Promise<void> {
  try {
    const embedding = await embedQuery(query);
    const embeddingStr = `[${embedding.join(',')}]`;

    await pool.query(
      `INSERT INTO query_cache (query, query_embedding, answer, citations, sources, department, cached_at)
       VALUES ($1, $2::vector, $3, $4, $5, $6, NOW())
       ON CONFLICT DO NOTHING`,
      [query, embeddingStr, answer, JSON.stringify(citations), JSON.stringify(sources), department ?? null]
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
}
