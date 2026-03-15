import dotenv from 'dotenv';
import type { RegulationSource } from '../sources/buildings-dept.js';
import { ingestSources } from '../pipeline/ingest.js';
import { closePool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';

dotenv.config();

const EPD = 'https://www.epd.gov.hk';
const NOISE_BASE = `${EPD}/epd/sites/default/files/epd/english/environmentinhk/noise/guide_ref/files`;
const PUB_BASE = `${EPD}/epd/sites/default/files/epd/english/resources_pub/publications/files`;

const EPD_SOURCES: RegulationSource[] = [
  {
    name: 'Technical Memoranda under Noise Control Ordinance (Cap. 400) - Consolidated',
    url: `${NOISE_BASE}/tm_nco400_eng.pdf`,
    version: 'consolidated',
    department: 'EPD',
    type: 'code_of_practice',
    category: 'noise',
  },
  {
    name: 'CoP on Good Management Practice - Noise Control (Construction Industry)',
    url: `${NOISE_BASE}/construction_cop.pdf`,
    version: 'current',
    department: 'EPD',
    type: 'code_of_practice',
    category: 'noise',
  },
  {
    name: 'CoP on Good Management Practice - Noise Control (Industrial/Commercial)',
    url: `${NOISE_BASE}/industrial_cop.pdf`,
    version: 'current',
    department: 'EPD',
    type: 'code_of_practice',
    category: 'noise',
  },
  {
    name: 'Concise Guide to the Noise Control Ordinance',
    url: `${NOISE_BASE}/CG_E-06n.pdf`,
    version: 'current',
    department: 'EPD',
    type: 'code_of_practice',
    category: 'noise',
  },
  {
    name: 'Guidelines on Design of Noise Barriers',
    url: `${NOISE_BASE}/noise_barriers.pdf`,
    version: 'current',
    department: 'EPD',
    type: 'code_of_practice',
    category: 'noise',
  },
  {
    name: 'ProPECC PN 24/1: Minimizing Noise from Construction Activities',
    url: `${PUB_BASE}/pn24_1.pdf`,
    version: 'current',
    department: 'EPD',
    type: 'practice_note',
    category: 'noise',
  },
  {
    name: 'ProPECC PN 23/3: Sound Insulation in Residential Buildings',
    url: `${PUB_BASE}/pn23_3.pdf`,
    version: 'current',
    department: 'EPD',
    type: 'practice_note',
    category: 'noise',
  },
  {
    name: 'ProPECC PN 23/4: Planning of Residential Developments Against Road Traffic Noise',
    url: `${PUB_BASE}/pn23_4.pdf`,
    version: 'current',
    department: 'EPD',
    type: 'practice_note',
    category: 'noise',
  },
  {
    name: 'Dealing with Noise Nuisance - Guide',
    url: `${EPD}/epd/sites/default/files/epd/english/environmentinhk/noise/guide_ref/Dealing%20with%20Noise%20Nuisance.pdf`,
    version: 'current',
    department: 'EPD',
    type: 'code_of_practice',
    category: 'noise',
  },
  {
    name: 'Guidelines on Managing Quiet Renovation',
    url: `${NOISE_BASE}/Management_Guidebook_ENG.pdf`,
    version: 'current',
    department: 'EPD',
    type: 'code_of_practice',
    category: 'noise',
  },
];

async function main(): Promise<void> {
  console.log('=== EPD Noise Control Sources Ingestion ===\n');
  await runMigrations();

  console.log(`[Scrape] ${EPD_SOURCES.length} EPD sources to process\n`);
  const results = await ingestSources(EPD_SOURCES, 2);

  const ingested = results.filter(r => r.status === 'ingested');
  const failed = results.filter(r => r.status === 'failed');

  console.log('\n=== RESULTS ===');
  console.log(`  Ingested: ${ingested.length}`);
  console.log(`  Failed: ${failed.length}`);

  let total = 0;
  for (const r of ingested) {
    console.log(`  ✓ ${r.source.name}: ${r.chunksCreated} chunks`);
    total += r.chunksCreated;
  }
  for (const r of failed) {
    console.error(`  ✗ ${r.source.name}: ${r.error}`);
  }
  console.log(`\n  Total new chunks: ${total}`);

  await closePool();
}

main().catch(err => { console.error(err); process.exit(1); });
