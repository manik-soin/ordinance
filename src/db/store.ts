import type pg from 'pg';
import type { EmbeddedChunk } from '../embedder/index.js';

/**
 * Store embedded chunks in the regulation_chunks table.
 */
export async function storeChunks(
  pool: pg.Pool,
  chunks: EmbeddedChunk[]
): Promise<string[]> {
  const ids: string[] = [];

  for (const chunk of chunks) {
    const embeddingStr = `[${chunk.embedding.join(',')}]`;
    const { rows } = await pool.query(
      `INSERT INTO regulation_chunks (
        content, embedding, source_department, document_type, document_name,
        version, effective_date, section_hierarchy, page_number,
        is_current, cross_references, content_hash, ingested_at
      ) VALUES ($1, $2::vector, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id`,
      [
        chunk.content,
        embeddingStr,
        chunk.metadata.source_department,
        chunk.metadata.document_type,
        chunk.metadata.document_name,
        chunk.metadata.version,
        chunk.metadata.effective_date ?? null,
        chunk.metadata.section_hierarchy,
        chunk.metadata.page_number,
        chunk.metadata.is_current,
        chunk.metadata.cross_references,
        chunk.metadata.content_hash,
        chunk.metadata.ingested_at,
      ]
    );
    ids.push(rows[0].id as string);
  }

  return ids;
}

/**
 * Mark existing chunks for a document as superseded.
 */
export async function supersedePreviousChunks(
  pool: pg.Pool,
  documentName: string,
  department: string
): Promise<number> {
  const result = await pool.query(
    `UPDATE regulation_chunks
     SET is_current = false
     WHERE document_name = $1 AND source_department = $2 AND is_current = true`,
    [documentName, department]
  );
  return result.rowCount ?? 0;
}

/**
 * Get stored content hash for a document.
 */
export async function getDocumentHash(
  pool: pg.Pool,
  documentName: string,
  department: string
): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT content_hash FROM document_versions
     WHERE document_name = $1 AND source_department = $2 AND status = 'current'
     ORDER BY fetched_at DESC LIMIT 1`,
    [documentName, department]
  );
  return (rows[0]?.content_hash as string) ?? null;
}

/**
 * Record a new document version.
 */
export async function recordDocumentVersion(
  pool: pg.Pool,
  documentName: string,
  department: string,
  version: string,
  contentHash: string,
  pdfUrl: string,
  chunkCount: number
): Promise<string> {
  // Supersede previous version
  await pool.query(
    `UPDATE document_versions SET status = 'superseded'
     WHERE document_name = $1 AND source_department = $2 AND status = 'current'`,
    [documentName, department]
  );

  const { rows } = await pool.query(
    `INSERT INTO document_versions (document_name, source_department, version, content_hash, pdf_url, chunk_count)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [documentName, department, version, contentHash, pdfUrl, chunkCount]
  );

  return rows[0].id as string;
}

/**
 * Log a query for audit purposes.
 */
export async function logQueryAudit(
  pool: pg.Pool,
  data: {
    query: string;
    filters?: Record<string, unknown>;
    chunkIds: string[];
    response: string;
    citations: unknown;
    faithfulnessScore: number;
    citationAccuracy: number;
    model: string;
    latencyMs: number;
  }
): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO query_audit_log (
      query, filters, retrieved_chunk_ids, response, citations,
      faithfulness_score, citation_accuracy, model_used, latency_ms
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      data.query,
      JSON.stringify(data.filters ?? {}),
      data.chunkIds,
      data.response,
      JSON.stringify(data.citations),
      data.faithfulnessScore,
      data.citationAccuracy,
      data.model,
      data.latencyMs,
    ]
  );
  return rows[0].id as string;
}

/**
 * Get document source statistics.
 */
export async function getSourceStats(
  pool: pg.Pool
): Promise<
  Array<{
    department: string;
    document_count: number;
    chunk_count: number;
    last_updated: string;
  }>
> {
  const { rows } = await pool.query(
    `SELECT
      source_department AS department,
      COUNT(DISTINCT document_name) AS document_count,
      COUNT(*) AS chunk_count,
      MAX(ingested_at) AS last_updated
    FROM regulation_chunks
    WHERE is_current = true
    GROUP BY source_department
    ORDER BY source_department`
  );
  return rows as Array<{
    department: string;
    document_count: number;
    chunk_count: number;
    last_updated: string;
  }>;
}
