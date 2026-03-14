import type { RegulationSource } from '../sources/buildings-dept.js';
import { fetchPdf, storePdf } from '../scraper/index.js';
import { parsePdf } from '../parser/index.js';
import { chunkDocument, chunkPlainText } from '../chunker/index.js';
import { embedChunks } from '../embedder/index.js';
import { getPool } from '../db/pool.js';
import {
  storeChunks,
  supersedePreviousChunks,
  getDocumentHash,
  recordDocumentVersion,
} from '../db/store.js';

export interface IngestionResult {
  source: RegulationSource;
  status: 'ingested' | 'unchanged' | 'failed';
  chunksCreated: number;
  contentHash: string;
  error?: string;
  durationMs: number;
}

/**
 * Full ingestion pipeline for a single regulation source:
 * Fetch → Parse → Chunk → Embed → Store
 */
export async function ingestSource(
  source: RegulationSource,
  options?: { forceReIngest?: boolean; storageDir?: string }
): Promise<IngestionResult> {
  const start = Date.now();
  const pool = getPool();
  const storageDir = options?.storageDir ?? './data/pdfs';

  try {
    // 1. Fetch PDF
    const { buffer, contentHash } = await fetchPdf(source.url);

    // 2. Check for changes (skip if unchanged)
    if (!options?.forceReIngest) {
      const previousHash = await getDocumentHash(pool, source.name, source.department);
      if (previousHash === contentHash) {
        return {
          source,
          status: 'unchanged',
          chunksCreated: 0,
          contentHash,
          durationMs: Date.now() - start,
        };
      }
    }

    // 3. Store PDF locally
    await storePdf(buffer, storageDir, source);

    // 4. Parse PDF
    const parsed = await parsePdf(buffer);

    // 5. Chunk
    const chunks =
      parsed.sections.length > 0
        ? chunkDocument(parsed.sections, source, contentHash)
        : chunkPlainText(parsed.fullText, source, contentHash);

    // 6. Embed
    const embedded = await embedChunks(chunks);

    // 7. Supersede old chunks
    await supersedePreviousChunks(pool, source.name, source.department);

    // 8. Store new chunks
    await storeChunks(pool, embedded);

    // 9. Record version
    await recordDocumentVersion(
      pool,
      source.name,
      source.department,
      source.version,
      contentHash,
      source.url,
      embedded.length
    );

    return {
      source,
      status: 'ingested',
      chunksCreated: embedded.length,
      contentHash,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      source,
      status: 'failed',
      chunksCreated: 0,
      contentHash: '',
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Ingest multiple sources with concurrency control.
 */
export async function ingestSources(
  sources: RegulationSource[],
  concurrency = 2
): Promise<IngestionResult[]> {
  const results: IngestionResult[] = [];

  for (let i = 0; i < sources.length; i += concurrency) {
    const batch = sources.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((source) => ingestSource(source))
    );
    results.push(...batchResults);

    // Log progress
    const done = Math.min(i + concurrency, sources.length);
    console.log(`[Ingest] Progress: ${done}/${sources.length}`);
  }

  return results;
}
