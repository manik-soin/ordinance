import dotenv from 'dotenv';
import { BD_CODES_OF_PRACTICE } from '../sources/buildings-dept.js';
import { EMSD_CODES_OF_PRACTICE } from '../sources/emsd.js';
import { HA_SOURCES } from '../sources/housing-authority.js';
import type { RegulationSource } from '../sources/buildings-dept.js';
import { ingestSources } from '../pipeline/ingest.js';
import { closePool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';

dotenv.config();

const DEPT_SOURCES: Record<string, RegulationSource[]> = {
  BD: BD_CODES_OF_PRACTICE,
  EMSD: EMSD_CODES_OF_PRACTICE,
  HA: HA_SOURCES,
};

async function main(): Promise<void> {
  const deptArg = process.argv[2]?.toUpperCase();
  const depts = deptArg && DEPT_SOURCES[deptArg]
    ? { [deptArg]: DEPT_SOURCES[deptArg] }
    : DEPT_SOURCES;

  await runMigrations();

  for (const [dept, sources] of Object.entries(depts)) {
    console.log(`\n[Scrape] Starting ${dept} ingestion (${sources.length} sources)...`);

    const results = await ingestSources(sources, 2);

    const ingested = results.filter((r) => r.status === 'ingested');
    const unchanged = results.filter((r) => r.status === 'unchanged');
    const failed = results.filter((r) => r.status === 'failed');

    console.log(`[Scrape] ${dept} results:`);
    console.log(`  Ingested: ${ingested.length}`);
    console.log(`  Unchanged: ${unchanged.length}`);
    console.log(`  Failed: ${failed.length}`);

    for (const r of failed) {
      console.error(`  FAILED: ${r.source.name} — ${r.error}`);
    }

    for (const r of ingested) {
      console.log(`  ✓ ${r.source.name}: ${r.chunksCreated} chunks (${r.durationMs}ms)`);
    }
  }

  await closePool();
}

main().catch((err) => {
  console.error('[Scrape] Fatal error:', err);
  process.exit(1);
});
