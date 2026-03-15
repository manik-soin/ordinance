import dotenv from 'dotenv';
import type { RegulationSource } from '../sources/buildings-dept.js';
import { ingestSources } from '../pipeline/ingest.js';
import { closePool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';

dotenv.config();

const BD_BASE = 'https://www.bd.gov.hk';
const CODES_BASE = `${BD_BASE}/doc/en/resources/codes-and-references/code-and-design-manuals`;
const PNAP_BASE = `${BD_BASE}/doc/en/resources/codes-and-references/practice-notes-and-circular-letters/pnap`;
const PNRC_BASE = `${BD_BASE}/doc/en/resources/codes-and-references/practice-notes-and-circular-letters/pnrc`;
const PNBI_BASE = `${BD_BASE}/doc/en/resources/codes-and-references/practice-notes-and-circular-letters/pnbi`;
const FSD_BASE = 'https://www.hkfsd.gov.hk/eng/source';

/** Additional BD Codes of Practice & Design Manuals not yet ingested */
const BD_EXTRA_CODES: RegulationSource[] = [
  { name: 'CoP for Overall Thermal Transfer Value (OTTV) 1995', url: `${CODES_BASE}/OTTV1995_e.pdf`, version: '1995', department: 'BD', type: 'code_of_practice', category: 'energy' },
  { name: 'CoP for Means of Access for Firefighting and Rescue 2004', url: `${CODES_BASE}/MOA2004e.pdf`, version: '2004', department: 'BD', type: 'code_of_practice', category: 'fire_safety' },
  { name: 'CoP for Means of Escape in Case of Fire 1996', url: `${CODES_BASE}/MOE1996_e.pdf`, version: '1996', department: 'BD', type: 'code_of_practice', category: 'fire_safety' },
  { name: 'CoP on Access for External Maintenance 2021', url: `${CODES_BASE}/cop_on_access_for_external_maintenance_2021.pdf`, version: '2021 (2024 Edition)', department: 'BD', type: 'code_of_practice', category: 'maintenance' },
  { name: 'CoP for Precast Concrete Construction 2016', url: `${CODES_BASE}/cppcc2016e.pdf`, version: '2016', department: 'BD', type: 'code_of_practice', category: 'structural' },
  { name: 'Technical Memorandum for Supervision Plans 2009', url: `${CODES_BASE}/TMSS2009_e.pdf`, version: '2009', department: 'BD', type: 'code_of_practice', category: 'supervision' },
  { name: 'Explanatory Materials to Steel Code 2011', url: `${CODES_BASE}/EMSUOS2011e.pdf`, version: '2011', department: 'BD', type: 'code_of_practice', category: 'structural' },
  { name: 'Explanatory Notes to Wind Effects Code 2019', url: `${CODES_BASE}/ExplanatoryNotesWindEffects2019e.pdf`, version: '2019', department: 'BD', type: 'code_of_practice', category: 'structural' },
  { name: 'CoP for MBIS and MWIS 2012 (2023 Edition)', url: `${CODES_BASE}/CoP_MBIS_MWISe.pdf`, version: '2012 (2023 Edition)', department: 'BD', type: 'code_of_practice', category: 'inspection' },
  { name: 'Guide to Fire Safety Design for Caverns 1994', url: `${CODES_BASE}/Fsdfc_1994.pdf`, version: '1994', department: 'BD', type: 'code_of_practice', category: 'fire_safety' },
  { name: 'CoP for Oil Storage Installations 1992', url: `${CODES_BASE}/Osi_1992.pdf`, version: '1992', department: 'BD', type: 'code_of_practice', category: 'fire_safety' },
];

/** BD Guidelines */
const BD_GUIDELINES: RegulationSource[] = [
  { name: 'Guidelines on Energy Efficiency of Residential Buildings 2014', url: `${CODES_BASE}/Guidelines_DCREERB2014e.pdf`, version: '2014', department: 'BD', type: 'code_of_practice', category: 'energy' },
  { name: 'General Guidelines on Minor Works Control System', url: `${CODES_BASE}/MW/MWGGe.pdf`, version: 'current', department: 'BD', type: 'code_of_practice', category: 'administration' },
  { name: 'Practice Guidebook for Heritage Buildings 2012 (2021 Edition)', url: `${CODES_BASE}/heritage_2021.pdf`, version: '2012 (2021 Edition)', department: 'BD', type: 'code_of_practice', category: 'heritage' },
  { name: 'Guidelines on Design and Construction of Bamboo Scaffolds', url: `${CODES_BASE}/GDCBS.pdf`, version: 'current', department: 'BD', type: 'code_of_practice', category: 'structural' },
  { name: 'Guidelines on Prevention of Water Seepage in New Buildings', url: `${CODES_BASE}/GWS.pdf`, version: 'current', department: 'BD', type: 'code_of_practice', category: 'drainage' },
  { name: 'Guidelines on Maintenance of Drainage System', url: `${CODES_BASE}/Drainage-System-Guideline-Eng.PDF`, version: 'current', department: 'BD', type: 'code_of_practice', category: 'drainage' },
  { name: 'Building Maintenance Guidebook', url: `${CODES_BASE}/bmg/BDG_ENG.pdf`, version: 'current', department: 'BD', type: 'code_of_practice', category: 'maintenance' },
  { name: 'Introductory Guide on Greening in Buildings', url: `${CODES_BASE}/IGG_e.pdf`, version: 'current', department: 'BD', type: 'code_of_practice', category: 'sustainability' },
];

/** BD PNAP ADV (Advisory) series */
const BD_PNAP_ADV: RegulationSource[] = [
  { name: 'PNAP ADV-1: Asbestos', url: `${PNAP_BASE}/ADV/ADV001.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'safety' },
  { name: 'PNAP ADV-2: Legislation and Publications', url: `${PNAP_BASE}/ADV/ADV002.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'administration' },
  { name: 'PNAP ADV-3: Advisory Note 3', url: `${PNAP_BASE}/ADV/ADV003.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'administration' },
  { name: 'PNAP ADV-4: Advisory Note 4', url: `${PNAP_BASE}/ADV/ADV004.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'administration' },
  { name: 'PNAP ADV-5: Advisory Note 5', url: `${PNAP_BASE}/ADV/ADV005.pdf`, version: 'current', department: 'BD', type: 'practice_note', category: 'administration' },
];

/** BD PNBI (Building & Window Inspection) */
const BD_PNBI: RegulationSource[] = Array.from({ length: 10 }, (_, i) => ({
  name: `PNBI-${i + 1}: Building/Window Inspection Practice Note ${i + 1}`,
  url: `${PNBI_BASE}/PNBI${String(i + 1).padStart(3, '0')}.pdf`,
  version: 'current',
  department: 'BD',
  type: 'practice_note' as const,
  category: 'inspection',
}));

/** BD PNRC (Registered Contractors) — key selections */
const PNRC_NUMBERS = [1,2,3,4,5,6,7,11,12,13,14,15,17,19,21,22,23,24,25,26,27,29,30,31,32,33,34,36,37,38,41,42,43,46,47,48,49,52,54,59,60,61,62,63,64,65,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85];
const BD_PNRC: RegulationSource[] = PNRC_NUMBERS.map(n => ({
  name: `PNRC ${n}: Practice Note for Registered Contractors`,
  url: `${PNRC_BASE}/Pnrc${String(n).padStart(2, '0')}.pdf`,
  version: 'current',
  department: 'BD',
  type: 'practice_note' as const,
  category: 'contractors',
}));

/** FSD Codes of Practice — key editions */
const FSD_CODES: RegulationSource[] = [
  { name: 'FSD CoP for Minimum FSI and Equipment (Sep 2022)', url: `${FSD_BASE}/safety/File2022.pdf`, version: '2022', department: 'FSD', type: 'code_of_practice', category: 'fire_safety' },
  { name: 'FSD CoP for FSI (Apr 2012)', url: `${FSD_BASE}/safety/File2012.pdf`, version: '2012', department: 'FSD', type: 'code_of_practice', category: 'fire_safety' },
  { name: 'FSD CoP for FSI (Jul 2005)', url: `${FSD_BASE}/safety/File2005.pdf`, version: '2005', department: 'FSD', type: 'code_of_practice', category: 'fire_safety' },
  { name: 'FSD CoP for FSI Installation (1994)', url: `${FSD_BASE}/safety/installation_1994.pdf`, version: '1994', department: 'FSD', type: 'code_of_practice', category: 'fire_safety' },
  { name: 'FSD CoP for FSI Testing and Maintenance (1994)', url: `${FSD_BASE}/safety/testing_1994.pdf`, version: '1994', department: 'FSD', type: 'code_of_practice', category: 'fire_safety' },
];

/** FSD Technical Guidance */
const FSD_GUIDANCE: RegulationSource[] = [
  { name: 'FSD TG: Fire Detection and Alarm (BS 5839-1:2017)', url: `${FSD_BASE}/guidance/TG_BS5839_1_eng.pdf`, version: '2017', department: 'FSD', type: 'code_of_practice', category: 'fire_safety' },
  { name: 'FSD TG: Emergency Lighting (BS 5266-1:2016)', url: `${FSD_BASE}/guidance/Technical_Guidance_BS5266_2016_BSEN1838_2013.pdf`, version: '2016', department: 'FSD', type: 'code_of_practice', category: 'fire_safety' },
  { name: 'FSD TG: Automatic Sprinkler Installations (LPC Rules 2015)', url: `${FSD_BASE}/guidance/Technical_Guidance_LPC_Rules_eng_20200911_153808.pdf`, version: '2015', department: 'FSD', type: 'code_of_practice', category: 'fire_safety' },
  { name: 'FSD Practical Guide for FSI Design and Maintenance', url: `${FSD_BASE}/licensing/Practical_Guide.pdf`, version: 'current', department: 'FSD', type: 'code_of_practice', category: 'fire_safety' },
];

/** FSD Fire Protection Notices */
const FSD_NOTICES: RegulationSource[] = [
  { name: 'FSD FPN 9: Electrical Safety', url: `${FSD_BASE}/notices/Fire_Protection_Notice_No_9.pdf`, version: 'current', department: 'FSD', type: 'practice_note', category: 'fire_safety' },
  { name: 'FSD FPN 11: Fire Extinguishers Suitability and Maintenance', url: `${FSD_BASE}/notices/Fire_Protection_Notice_No_11.pdf`, version: 'current', department: 'FSD', type: 'practice_note', category: 'fire_safety' },
  { name: 'FSD FPN 13: Fire Protection in Construction Sites', url: `${FSD_BASE}/notices/Fire_Protection_Notice_No_13.pdf`, version: 'current', department: 'FSD', type: 'practice_note', category: 'fire_safety' },
  { name: 'FSD FPN 16: Fire Detection System Maintenance', url: `${FSD_BASE}/notices/Fire_Protection_Notice_No_16.pdf`, version: 'current', department: 'FSD', type: 'practice_note', category: 'fire_safety' },
];

async function main(): Promise<void> {
  console.log('=== HK Compliance RAG — Extended Source Ingestion ===\n');

  await runMigrations();

  const allSources: RegulationSource[] = [
    ...BD_EXTRA_CODES,
    ...BD_GUIDELINES,
    ...BD_PNAP_ADV,
    ...BD_PNBI,
    ...BD_PNRC,
    ...FSD_CODES,
    ...FSD_GUIDANCE,
    ...FSD_NOTICES,
  ];

  console.log(`[Scrape] Total NEW sources to process: ${allSources.length}`);
  console.log(`  - BD Extra Codes/Manuals: ${BD_EXTRA_CODES.length}`);
  console.log(`  - BD Guidelines: ${BD_GUIDELINES.length}`);
  console.log(`  - BD PNAP ADV: ${BD_PNAP_ADV.length}`);
  console.log(`  - BD PNBI: ${BD_PNBI.length}`);
  console.log(`  - BD PNRC: ${BD_PNRC.length}`);
  console.log(`  - FSD Codes: ${FSD_CODES.length}`);
  console.log(`  - FSD Technical Guidance: ${FSD_GUIDANCE.length}`);
  console.log(`  - FSD Fire Protection Notices: ${FSD_NOTICES.length}`);
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
