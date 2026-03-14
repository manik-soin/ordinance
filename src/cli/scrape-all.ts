import dotenv from 'dotenv';
import type { RegulationSource } from '../sources/buildings-dept.js';
import { BD_CODES_OF_PRACTICE } from '../sources/buildings-dept.js';
import { ingestSources } from '../pipeline/ingest.js';
import { closePool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';

dotenv.config();

const BD_BASE = 'https://www.bd.gov.hk';
const PNAP_BASE = `${BD_BASE}/doc/en/resources/codes-and-references/practice-notes-and-circular-letters/pnap`;
const CL_BASE = `${BD_BASE}/doc/en/resources/codes-and-references/practice-notes-and-circular-letters/circular`;
const JPN_BASE = `${BD_BASE}/doc/en/resources/codes-and-references/practice-notes-and-circular-letters/joint`;

/**
 * BD Practice Notes for Authorized Persons (PNAPs) — ADM series
 */
const BD_PNAP_ADM: RegulationSource[] = [
  { name: 'PNAP ADM-1: Practice Notes in Force', url: `${PNAP_BASE}/ADM/ADM001.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'administration' },
  { name: 'PNAP ADM-2: Centralised Processing of Building Plans', url: `${PNAP_BASE}/ADM/ADM002.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'administration' },
  { name: 'PNAP ADM-3: Emergency Situations - Telephone Numbers', url: `${PNAP_BASE}/ADM/ADM003.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'administration' },
  { name: 'PNAP ADM-4: Priority', url: `${PNAP_BASE}/ADM/ADM004.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'administration' },
  { name: 'PNAP ADM-5: Submissions to the Buildings Department', url: `${PNAP_BASE}/ADM/ADM005.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'administration' },
  { name: 'PNAP ADM-6: Computer Programs for Structural Design', url: `${PNAP_BASE}/ADM/ADM006.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'administration' },
  { name: 'PNAP ADM-7: Geotechnical Information Unit', url: `${PNAP_BASE}/ADM/ADM007.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'administration' },
  { name: 'PNAP ADM-8: Structural Design Information', url: `${PNAP_BASE}/ADM/ADM008.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'structural' },
  { name: 'PNAP ADM-9: Colouring of Plans', url: `${PNAP_BASE}/ADM/ADM009.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'administration' },
  { name: 'PNAP ADM-10: Imaging Standards for Plans', url: `${PNAP_BASE}/ADM/ADM010.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'administration' },
  { name: 'PNAP ADM-11: Change of Address', url: `${PNAP_BASE}/ADM/ADM011.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'administration' },
  { name: 'PNAP ADM-13: Monitoring for Site Safety and Quality', url: `${PNAP_BASE}/ADM/ADM013.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'supervision' },
  { name: 'PNAP ADM-14: Minor Amendments to Plans', url: `${PNAP_BASE}/ADM/ADM014.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'administration' },
  { name: 'PNAP ADM-15: Submission of Site Formation Proposals', url: `${PNAP_BASE}/ADM/ADM015.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'geotechnical' },
  { name: 'PNAP ADM-16: Ground Investigation in Scheduled Areas', url: `${PNAP_BASE}/ADM/ADM016.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'geotechnical' },
  { name: 'PNAP ADM-17: Submission of Plans in Electronic Format', url: `${PNAP_BASE}/ADM/ADM017.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'administration' },
  { name: 'PNAP ADM-18: Site Auditing for Building Works', url: `${PNAP_BASE}/ADM/ADM018.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'supervision' },
  { name: 'PNAP ADM-19: Building Approval Process', url: `${PNAP_BASE}/ADM/ADM019.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'administration' },
  { name: 'PNAP ADM-20: Central Data Bank', url: `${PNAP_BASE}/ADM/ADM020.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'administration' },
  { name: 'PNAP ADM-21: Site Parameters - Documentary Proof', url: `${PNAP_BASE}/ADM/ADM021.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'administration' },
  { name: 'PNAP ADM-22: Withdrawal and Resubmission', url: `${PNAP_BASE}/ADM/ADM022.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'administration' },
  { name: 'PNAP ADM-23: Self-certification for Simple Structural Works', url: `${PNAP_BASE}/ADM/ADM023.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'structural' },
];

/**
 * BD Practice Notes — APP series (key selections covering major topics)
 */
const BD_PNAP_APP: RegulationSource[] = [
  { name: 'PNAP APP-2: Calculation of Gross Floor Area', url: `${PNAP_BASE}/APP/APP002.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'planning' },
  { name: 'PNAP APP-7: Registration as AP/RSE/RGE/RI', url: `${PNAP_BASE}/APP/APP007.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'administration' },
  { name: 'PNAP APP-13: Certificate of Completion and Occupation Permit', url: `${PNAP_BASE}/APP/APP013.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'administration' },
  { name: 'PNAP APP-16: Cladding', url: `${PNAP_BASE}/APP/APP016.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'structural' },
  { name: 'PNAP APP-18: Code of Practice for Foundations 2017', url: `${PNAP_BASE}/APP/APP018.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'geotechnical' },
  { name: 'PNAP APP-19: Projections - Site Coverage and Plot Ratio', url: `${PNAP_BASE}/APP/APP019.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'planning' },
  { name: 'PNAP APP-21: Demolition Works for Public Safety', url: `${PNAP_BASE}/APP/APP021.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'demolition' },
  { name: 'PNAP APP-22: Dewatering in Foundation and Basement Excavation', url: `${PNAP_BASE}/APP/APP022.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'geotechnical' },
  { name: 'PNAP APP-24: Railway Protection under Railways Ordinance', url: `${PNAP_BASE}/APP/APP024.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'planning' },
  { name: 'PNAP APP-25: Geotechnical Assessment at GBP Stage', url: `${PNAP_BASE}/APP/APP025.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'geotechnical' },
  { name: 'PNAP APP-28: Qualified Supervision of Site Formation Works', url: `${PNAP_BASE}/APP/APP028.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'supervision' },
  { name: 'PNAP APP-29: Lift and Escalator Installations', url: `${PNAP_BASE}/APP/APP029.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'mep' },
  { name: 'PNAP APP-33: Pulverised Fuel Ash in Concrete', url: `${PNAP_BASE}/APP/APP033.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'structural' },
  { name: 'PNAP APP-35: Refuse Storage and Collection', url: `${PNAP_BASE}/APP/APP035.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'planning' },
  { name: 'PNAP APP-37: Curtain Wall, Window and Window Wall', url: `${PNAP_BASE}/APP/APP037.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'structural' },
  { name: 'PNAP APP-40: Hotel Development', url: `${PNAP_BASE}/APP/APP040.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'planning' },
  { name: 'PNAP APP-41: Buildings for Use by Persons with Disability', url: `${PNAP_BASE}/APP/APP041.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'accessibility' },
  { name: 'PNAP APP-48: Qualified Supervision of Structural Works', url: `${PNAP_BASE}/APP/APP048.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'supervision' },
  { name: 'PNAP APP-49: Site Investigation and Ground Investigation', url: `${PNAP_BASE}/APP/APP049.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'geotechnical' },
  { name: 'PNAP APP-57: Excavation and Lateral Support Plan', url: `${PNAP_BASE}/APP/APP057.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'geotechnical' },
  { name: 'PNAP APP-67: Energy Efficiency of Buildings', url: `${PNAP_BASE}/APP/APP067.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'energy' },
  { name: 'PNAP APP-68: Design of Cantilevered RC Structures', url: `${PNAP_BASE}/APP/APP068.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'structural' },
  { name: 'PNAP APP-75: Means of Access for Firefighting and Rescue', url: `${PNAP_BASE}/APP/APP075.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'fire_safety' },
  { name: 'PNAP APP-80: Fire Resisting Construction 1996', url: `${PNAP_BASE}/APP/APP080.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'fire_safety' },
  { name: 'PNAP APP-82: Means of Escape in Case of Fire 1996', url: `${PNAP_BASE}/APP/APP082.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'fire_safety' },
  { name: 'PNAP APP-85: Application of Revised Fire Safety Codes', url: `${PNAP_BASE}/APP/APP085.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'fire_safety' },
  { name: 'PNAP APP-87: Guide to Fire Engineering Approach', url: `${PNAP_BASE}/APP/APP087.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'fire_safety' },
  { name: 'PNAP APP-93: Planning and Design of Drainage Works', url: `${PNAP_BASE}/APP/APP093.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'drainage' },
  { name: 'PNAP APP-104: Exclusion of Floor Areas for Recreational Use', url: `${PNAP_BASE}/APP/APP104.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'planning' },
  { name: 'PNAP APP-110: Protective Barriers', url: `${PNAP_BASE}/APP/APP110.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'structural' },
  { name: 'PNAP APP-111: Design of Car Parks and Loading Facilities', url: `${PNAP_BASE}/APP/APP111.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'planning' },
  { name: 'PNAP APP-116: Aluminium Windows', url: `${PNAP_BASE}/APP/APP116.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'structural' },
  { name: 'PNAP APP-117: Structural Requirements for A&A Works', url: `${PNAP_BASE}/APP/APP117.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'structural' },
  { name: 'PNAP APP-130: Lighting and Ventilation - Performance-based', url: `${PNAP_BASE}/APP/APP130.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'planning' },
  { name: 'PNAP APP-132: Site Coverage and Open Space Provision', url: `${PNAP_BASE}/APP/APP132.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'planning' },
  { name: 'PNAP APP-136: Emergency Vehicular Access', url: `${PNAP_BASE}/APP/APP136.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'fire_safety' },
  { name: 'PNAP APP-139: Code of Practice on Wind Effects', url: `${PNAP_BASE}/APP/APP139.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'structural' },
  { name: 'PNAP APP-142: Code of Practice for Structural Use of Concrete 2013', url: `${PNAP_BASE}/APP/APP142.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'structural' },
  { name: 'PNAP APP-145: Fire Safety (Buildings) Ordinance Cap. 572', url: `${PNAP_BASE}/APP/APP145.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'fire_safety' },
  { name: 'PNAP APP-147: Minor Works Control System', url: `${PNAP_BASE}/APP/APP147.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'administration' },
  { name: 'PNAP APP-150: Wholesale Conversion of Industrial Buildings', url: `${PNAP_BASE}/APP/APP150.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'planning' },
  { name: 'PNAP APP-151: Building Design for Quality and Sustainable Built Environment', url: `${PNAP_BASE}/APP/APP151.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'sustainability' },
  { name: 'PNAP APP-152: Sustainable Building Design Guidelines', url: `${PNAP_BASE}/APP/APP152.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'sustainability' },
  { name: 'PNAP APP-153: Fire Safety Code 2011', url: `${PNAP_BASE}/APP/APP153.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'fire_safety' },
  { name: 'PNAP APP-156: Energy Efficiency of Residential Buildings', url: `${PNAP_BASE}/APP/APP156.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'energy' },
  { name: 'PNAP APP-157: Code of Practice for Site Supervision 2009', url: `${PNAP_BASE}/APP/APP157.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'supervision' },
  { name: 'PNAP APP-158: Quality Supervision of Building Works', url: `${PNAP_BASE}/APP/APP158.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'supervision' },
  { name: 'PNAP APP-162: Conditions under Buildings Ordinance', url: `${PNAP_BASE}/APP/APP162.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'administration' },
  { name: 'PNAP APP-163: Access for External Maintenance 2021', url: `${PNAP_BASE}/APP/APP163.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'maintenance' },
  { name: 'PNAP APP-164: Enhanced Design of Aboveground Drainage', url: `${PNAP_BASE}/APP/APP164.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'drainage' },
  { name: 'PNAP APP-168: Code of Practice for Structural Use of Steel 2011', url: `${PNAP_BASE}/APP/APP168.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'structural' },
  { name: 'PNAP APP-170: Code of Practice for Demolition 2004', url: `${PNAP_BASE}/APP/APP170.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'demolition' },
  { name: 'PNAP APP-171: Code of Practice for Structural Use of Glass 2018', url: `${PNAP_BASE}/APP/APP171.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'structural' },
  { name: 'PNAP APP-172: Residential Care Homes for Elderly and Disabled', url: `${PNAP_BASE}/APP/APP172.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'planning' },
];

/**
 * BD Joint Practice Notes (JPNs) — issued by BD, Lands Dept, Planning Dept
 */
const BD_JPN: RegulationSource[] = [
  { name: 'JPN 1: Green and Innovative Buildings', url: `${JPN_BASE}/JPN01.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'sustainability' },
  { name: 'JPN 2: Second Package of Incentives for Green Buildings', url: `${JPN_BASE}/JPN02.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'sustainability' },
  { name: 'JPN 3: Landscape and Site Coverage of Greenery', url: `${JPN_BASE}/JPN03.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'sustainability' },
  { name: 'JPN 4: Development Control Parameters', url: `${JPN_BASE}/JPN04.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'planning' },
  { name: 'JPN 5: Building Height Restriction', url: `${JPN_BASE}/JPN05.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'planning' },
  { name: 'JPN 6: Sustainable Building Design - Separation and Setback', url: `${JPN_BASE}/JPN06.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'sustainability' },
  { name: 'JPN 7: Site Coverage Restriction', url: `${JPN_BASE}/JPN07.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'planning' },
  { name: 'JPN 8: Modular Integrated Construction Facilitation', url: `${JPN_BASE}/JPN08.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'sustainability' },
];

/**
 * BD Circular Letters — key recent ones
 */
const BD_CIRCULARS: RegulationSource[] = [
  { name: 'CL: Guidelines on Prevention of Water Seepage in New Buildings', url: `${CL_BASE}/GWS.pdf`, version: 'current', department: 'BD', type: 'circular_letter', category: 'drainage' },
  { name: 'CL 2025: Adoption of Standardised Material Test Reports', url: `${CL_BASE}/2025/CL_ASMTR2025e.pdf`, version: '2025', department: 'BD', type: 'circular_letter', category: 'structural' },
  { name: 'CL 2025: Use of Fire Retardant Protective Net', url: `${CL_BASE}/2025/CL_UFRPNSTPSFBCDAARMWAPRSERGERI2025e.pdf`, version: '2025', department: 'BD', type: 'circular_letter', category: 'fire_safety' },
  { name: 'CL 2025: Amendments to Technical Guidelines on Minor Works', url: `${CL_BASE}/2025/CL_ATGMWCS2025e.pdf`, version: '2025', department: 'BD', type: 'circular_letter', category: 'administration' },
  { name: 'CL 2026: Updating of Specified Forms under Minor Works', url: `${CL_BASE}/2026/CL_USFMWCS2026e.pdf`, version: '2026', department: 'BD', type: 'circular_letter', category: 'administration' },
  { name: 'CL 2026: Timely Submission of Notification by Qualified Person', url: `${CL_BASE}/2026/CL_TSNCQP2026e.pdf`, version: '2026', department: 'BD', type: 'circular_letter', category: 'supervision' },
];

async function main(): Promise<void> {
  console.log('=== HK Compliance RAG — Full Source Ingestion ===\n');

  await runMigrations();

  // Combine all sources (skip BD codes already ingested — they'll be detected as unchanged)
  const allSources: RegulationSource[] = [
    ...BD_CODES_OF_PRACTICE,
    ...BD_PNAP_ADM,
    ...BD_PNAP_APP,
    ...BD_JPN,
    ...BD_CIRCULARS,
  ];

  console.log(`[Scrape] Total sources to process: ${allSources.length}`);
  console.log(`  - BD Codes of Practice: ${BD_CODES_OF_PRACTICE.length}`);
  console.log(`  - BD PNAPs (ADM): ${BD_PNAP_ADM.length}`);
  console.log(`  - BD PNAPs (APP): ${BD_PNAP_APP.length}`);
  console.log(`  - BD Joint Practice Notes: ${BD_JPN.length}`);
  console.log(`  - BD Circular Letters: ${BD_CIRCULARS.length}`);
  console.log('');

  const results = await ingestSources(allSources, 2);

  const ingested = results.filter((r) => r.status === 'ingested');
  const unchanged = results.filter((r) => r.status === 'unchanged');
  const failed = results.filter((r) => r.status === 'failed');

  console.log('\n=== RESULTS ===');
  console.log(`  Ingested: ${ingested.length}`);
  console.log(`  Unchanged: ${unchanged.length}`);
  console.log(`  Failed: ${failed.length}`);

  let totalChunks = 0;
  for (const r of ingested) {
    console.log(`  ✓ ${r.source.name}: ${r.chunksCreated} chunks (${(r.durationMs / 1000).toFixed(1)}s)`);
    totalChunks += r.chunksCreated;
  }

  if (unchanged.length > 0) {
    console.log(`\n  Unchanged (already ingested):`);
    for (const r of unchanged) {
      console.log(`    ⏭ ${r.source.name}`);
    }
  }

  if (failed.length > 0) {
    console.log(`\n  Failed:`);
    for (const r of failed) {
      console.error(`    ✗ ${r.source.name}: ${r.error}`);
    }
  }

  console.log(`\n  Total new chunks created: ${totalChunks}`);
  console.log('=== DONE ===');

  await closePool();
}

main().catch((err) => {
  console.error('[Scrape] Fatal error:', err);
  process.exit(1);
});
