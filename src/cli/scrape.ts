import dotenv from 'dotenv';
import { BD_CODES_OF_PRACTICE } from '../sources/buildings-dept.js';
import { ingestSources } from '../pipeline/ingest.js';
import { closePool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';

dotenv.config();

async function main(): Promise<void> {
  console.log('[Scrape] Starting BD codes ingestion...');
  console.log(`[Scrape] ${BD_CODES_OF_PRACTICE.length} sources to process`);

  await runMigrations();

  const results = await ingestSources(BD_CODES_OF_PRACTICE, 2);

  const ingested = results.filter((r) => r.status === 'ingested');
  const unchanged = results.filter((r) => r.status === 'unchanged');
  const failed = results.filter((r) => r.status === 'failed');

  console.log('\n[Scrape] Results:');
  console.log(`  Ingested: ${ingested.length}`);
  console.log(`  Unchanged: ${unchanged.length}`);
  console.log(`  Failed: ${failed.length}`);

  for (const r of failed) {
    console.error(`  FAILED: ${r.source.name} — ${r.error}`);
  }

  for (const r of ingested) {
    console.log(`  ✓ ${r.source.name}: ${r.chunksCreated} chunks (${r.durationMs}ms)`);
  }

  await closePool();
}

main().catch((err) => {
  console.error('[Scrape] Fatal error:', err);
  process.exit(1);
});
