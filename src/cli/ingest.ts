import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parsePdf } from '../parser/index.js';
import { chunkDocument, chunkPlainText } from '../chunker/index.js';
import { embedChunks } from '../embedder/index.js';
import { storeChunks } from '../db/store.js';
import { getPool, closePool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';
import { computeHash } from '../scraper/index.js';
import type { RegulationSource } from '../sources/buildings-dept.js';

dotenv.config();

async function main(): Promise<void> {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error('Usage: npm run ingest <pdf-path> [department] [name]');
    process.exit(1);
  }

  const department = process.argv[3] ?? 'BD';
  const name = process.argv[4] ?? path.basename(pdfPath, '.pdf');

  console.log(`[Ingest] Processing: ${pdfPath}`);

  await runMigrations();

  const buffer = await fs.readFile(pdfPath);
  const contentHash = computeHash(buffer);
  const parsed = await parsePdf(buffer);

  console.log(`[Ingest] Parsed: ${parsed.pageCount} pages, ${parsed.sections.length} sections`);

  const source: RegulationSource = {
    name,
    url: pdfPath,
    version: 'manual',
    department,
    type: 'code_of_practice',
    category: 'general',
  };

  const chunks =
    parsed.sections.length > 0
      ? chunkDocument(parsed.sections, source, contentHash)
      : chunkPlainText(parsed.fullText, source, contentHash);

  console.log(`[Ingest] Chunked: ${chunks.length} chunks`);

  const embedded = await embedChunks(chunks);
  console.log(`[Ingest] Embedded: ${embedded.length} chunks`);

  const pool = getPool();
  const ids = await storeChunks(pool, embedded);
  console.log(`[Ingest] Stored: ${ids.length} chunks in database`);

  await closePool();
}

main().catch((err) => {
  console.error('[Ingest] Fatal error:', err);
  process.exit(1);
});
