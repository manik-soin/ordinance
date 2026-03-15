import cron from 'node-cron';
import { BD_CODES_OF_PRACTICE } from '../sources/buildings-dept.js';
import type { RegulationSource } from '../sources/buildings-dept.js';
import { EMSD_CODES_OF_PRACTICE } from '../sources/emsd.js';
import { HA_SOURCES } from '../sources/housing-authority.js';
import { fetchPdf, computeHash } from '../scraper/index.js';
import { getPool } from '../db/pool.js';
import { getDocumentHash, recordDocumentVersion } from '../db/store.js';

export interface ScheduleConfig {
  name: string;
  schedule: string; // cron expression
  sources: RegulationSource[];
}

export interface ScrapeRunResult {
  department: string;
  documentsChecked: number;
  documentsChanged: number;
  documentsFailed: number;
  errors: Array<{ document: string; error: string }>;
  startedAt: Date;
  completedAt: Date;
}

/**
 * Check a list of sources for changes.
 */
export async function checkForChanges(
  sources: RegulationSource[],
  concurrency = 3
): Promise<ScrapeRunResult> {
  const pool = getPool();
  const startedAt = new Date();
  const errors: Array<{ document: string; error: string }> = [];
  let changed = 0;
  let failed = 0;

  // Process in batches for concurrency control
  for (let i = 0; i < sources.length; i += concurrency) {
    const batch = sources.slice(i, i + concurrency);

    const results = await Promise.allSettled(
      batch.map(async (source) => {
        const previousHash = await getDocumentHash(pool, source.name, source.department);
        const { buffer, contentHash } = await fetchPdf(source.url);

        if (previousHash !== contentHash) {
          changed++;
          await recordDocumentVersion(
            pool,
            source.name,
            source.department,
            source.version,
            contentHash,
            source.url,
            0 // chunk count updated after ingestion
          );
          return { changed: true, source };
        }

        return { changed: false, source };
      })
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        failed++;
        errors.push({
          document: batch[results.indexOf(result)]?.name ?? 'unknown',
          error: String(result.reason),
        });
      }
    }
  }

  const completedAt = new Date();

  // Log to scrape_log table
  await pool.query(
    `INSERT INTO scrape_log (source_department, documents_checked, documents_changed, documents_failed, errors, started_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      sources[0]?.department ?? 'unknown',
      sources.length,
      changed,
      failed,
      JSON.stringify(errors),
      startedAt,
      completedAt,
    ]
  );

  return {
    department: sources[0]?.department ?? 'unknown',
    documentsChecked: sources.length,
    documentsChanged: changed,
    documentsFailed: failed,
    errors,
    startedAt,
    completedAt,
  };
}

/**
 * Default schedule configurations.
 */
export const DEFAULT_SCHEDULES: ScheduleConfig[] = [
  {
    name: 'BD Codes of Practice',
    schedule: '0 2 1 * *', // Monthly, 1st at 2am
    sources: BD_CODES_OF_PRACTICE,
  },
  {
    name: 'EMSD Codes of Practice',
    schedule: '0 3 1 * *', // Monthly, 1st at 3am
    sources: EMSD_CODES_OF_PRACTICE,
  },
  {
    name: 'HA Specifications',
    schedule: '0 4 1 * *', // Monthly, 1st at 4am
    sources: HA_SOURCES,
  },
];

/**
 * Start all scheduled scrape jobs.
 */
export function startScheduler(): void {
  for (const config of DEFAULT_SCHEDULES) {
    cron.schedule(config.schedule, async () => {
      console.log(`[Scheduler] Running: ${config.name}`);
      try {
        const result = await checkForChanges(config.sources);
        console.log(
          `[Scheduler] ${config.name}: checked=${result.documentsChecked}, changed=${result.documentsChanged}, failed=${result.documentsFailed}`
        );
      } catch (err) {
        console.error(`[Scheduler] ${config.name} failed:`, err);
      }
    });

    console.log(`[Scheduler] Registered: ${config.name} (${config.schedule})`);
  }
}
