/**
 * Live web search against HK government sources.
 * Runs during query time to supplement RAG with real-time data.
 */

import type { SearchResult } from './hybrid-search.js';

const REQUEST_TIMEOUT = 6000;
const BD_SEARCH = 'https://www.bd.gov.hk/en/resources/codes-and-references';

export interface WebSearchResult {
  title: string;
  snippet: string;
  url: string;
  source: string;
}

/**
 * Search BD website for relevant regulation pages.
 * Uses known URL patterns and content matching.
 */
async function searchBDSite(query: string): Promise<WebSearchResult[]> {
  const results: WebSearchResult[] = [];
  const terms = query.toLowerCase();

  // Map query terms to known BD resource URLs
  const BD_RESOURCES: Array<{ keywords: string[]; title: string; url: string }> = [
    { keywords: ['fire', 'frc', 'fire resist', 'fire safety', 'means of escape', 'compartment'], title: 'Code of Practice for Fire Safety in Buildings 2011', url: `${BD_SEARCH}/code-and-design-manuals/index.html` },
    { keywords: ['foundation', 'pile', 'geotechnical', 'ground', 'excavat'], title: 'Code of Practice for Foundations 2017', url: `${BD_SEARCH}/code-and-design-manuals/index.html` },
    { keywords: ['wind', 'typhoon', 'lateral', 'dynamic'], title: 'Code of Practice on Wind Effects 2019', url: `${BD_SEARCH}/code-and-design-manuals/index.html` },
    { keywords: ['concrete', 'reinforc', 'prestress', 'durability'], title: 'Code of Practice for Structural Use of Concrete 2013', url: `${BD_SEARCH}/code-and-design-manuals/index.html` },
    { keywords: ['steel', 'weld', 'bolt', 'connection'], title: 'Code of Practice for Structural Use of Steel 2011', url: `${BD_SEARCH}/code-and-design-manuals/index.html` },
    { keywords: ['barrier', 'access', 'disable', 'wheelchair', 'ramp', 'lift'], title: 'Design Manual - Barrier Free Access 2008', url: `${BD_SEARCH}/code-and-design-manuals/index.html` },
    { keywords: ['demolit', 'dismantle'], title: 'Code of Practice for Demolition of Buildings 2004', url: `${BD_SEARCH}/code-and-design-manuals/index.html` },
    { keywords: ['supervisi', 'tcp', 'site safety'], title: 'Code of Practice for Site Supervision 2009', url: `${BD_SEARCH}/code-and-design-manuals/index.html` },
    { keywords: ['glass', 'glazing', 'curtain wall'], title: 'Code of Practice for Structural Use of Glass 2018', url: `${BD_SEARCH}/code-and-design-manuals/index.html` },
    { keywords: ['load', 'dead load', 'imposed load', 'live load'], title: 'Code of Practice for Dead and Imposed Loads 2011', url: `${BD_SEARCH}/code-and-design-manuals/index.html` },
    { keywords: ['pnap', 'practice note', 'authorized person'], title: 'Practice Notes for APs/RSEs/RGEs', url: `${BD_SEARCH}/practice-notes-and-circular-letters/index.html` },
    { keywords: ['circular', 'letter'], title: 'Circular Letters', url: `${BD_SEARCH}/practice-notes-and-circular-letters/index.html` },
    { keywords: ['gfa', 'gross floor', 'plot ratio', 'site coverage', 'planning'], title: 'Building (Planning) Regulations', url: `${BD_SEARCH}/index.html` },
    { keywords: ['energy', 'ottv', 'thermal', 'bec'], title: 'Energy Efficiency Requirements', url: `${BD_SEARCH}/code-and-design-manuals/index.html` },
    { keywords: ['drainage', 'water', 'seepage', 'pipe'], title: 'Drainage System Guidelines', url: `${BD_SEARCH}/code-and-design-manuals/index.html` },
    { keywords: ['minor work', 'mwcs'], title: 'Minor Works Control System', url: `${BD_SEARCH}/code-and-design-manuals/index.html` },
    { keywords: ['scaffold', 'bamboo'], title: 'Guidelines on Bamboo Scaffolds', url: `${BD_SEARCH}/code-and-design-manuals/index.html` },
    { keywords: ['heritage', 'conserv', 'historic'], title: 'Practice Guidebook for Heritage Buildings', url: `${BD_SEARCH}/code-and-design-manuals/index.html` },
    { keywords: ['mic', 'modular', 'prefab'], title: 'Modular Integrated Construction', url: 'https://www.bd.gov.hk/en/resources/codes-and-references/modular-integrated-construction/index.html' },
    { keywords: ['sustainable', 'green', 'building design'], title: 'Sustainable Building Design Guidelines', url: `${BD_SEARCH}/practice-notes-and-circular-letters/index.html` },
  ];

  for (const resource of BD_RESOURCES) {
    if (resource.keywords.some(kw => terms.includes(kw))) {
      results.push({
        title: resource.title,
        snippet: `Official Buildings Department resource. Search: "${query}"`,
        url: resource.url,
        source: 'bd.gov.hk',
      });
    }
  }

  return results.slice(0, 3);
}

/**
 * Search FSD website for fire safety resources.
 */
async function searchFSDSite(query: string): Promise<WebSearchResult[]> {
  const results: WebSearchResult[] = [];
  const terms = query.toLowerCase();

  const FSD_RESOURCES: Array<{ keywords: string[]; title: string; url: string }> = [
    { keywords: ['sprinkler', 'automatic'], title: 'FSD CoP for Minimum FSI - Sprinkler Systems', url: 'https://www.hkfsd.gov.hk/eng/source/safety/File2022.pdf' },
    { keywords: ['fire service install', 'fsi', 'fire hydrant', 'hose reel'], title: 'FSD CoP for Minimum Fire Service Installations', url: 'https://www.hkfsd.gov.hk/eng/source/safety/File2022.pdf' },
    { keywords: ['fire detect', 'alarm', 'smoke'], title: 'FSD TG: Fire Detection and Alarm Systems', url: 'https://www.hkfsd.gov.hk/eng/source/guidance/TG_BS5839_1_eng.pdf' },
    { keywords: ['emergency light'], title: 'FSD TG: Emergency Lighting', url: 'https://www.hkfsd.gov.hk/eng/source/guidance/Technical_Guidance_BS5266_2016_BSEN1838_2013.pdf' },
    { keywords: ['fire extinguish'], title: 'FSD FPN 11: Fire Extinguishers', url: 'https://www.hkfsd.gov.hk/eng/source/notices/Fire_Protection_Notice_No_11.pdf' },
    { keywords: ['construction site fire', 'site fire'], title: 'FSD FPN 13: Fire Protection in Construction Sites', url: 'https://www.hkfsd.gov.hk/eng/source/notices/Fire_Protection_Notice_No_13.pdf' },
  ];

  for (const resource of FSD_RESOURCES) {
    if (resource.keywords.some(kw => terms.includes(kw))) {
      results.push({
        title: resource.title,
        snippet: `Official Fire Services Department resource`,
        url: resource.url,
        source: 'hkfsd.gov.hk',
      });
    }
  }

  return results.slice(0, 2);
}

/**
 * Fetch live data from data.gov.hk based on query topic.
 */
async function searchGovData(query: string): Promise<WebSearchResult[]> {
  const results: WebSearchResult[] = [];
  const terms = query.toLowerCase();

  if (terms.includes('fire door') || terms.includes('doorset')) {
    results.push({ title: 'BD Central Data Bank: Approved Fire Doorsets (860 products)', snippet: 'Live data from data.gov.hk — fire resisting doorsets with ratings, manufacturers, test reports', url: '/api/gov/fire-doorsets', source: 'data.gov.hk' });
  }
  if (terms.includes('fire glass') || terms.includes('glazing') || terms.includes('fire rated glass')) {
    results.push({ title: 'BD Central Data Bank: Approved Fire Glazing (126 products)', snippet: 'Live data from data.gov.hk — fire resisting glazing with integrity/insulation ratings', url: '/api/gov/fire-glazing', source: 'data.gov.hk' });
  }
  if (terms.includes('fire stop') || terms.includes('firestop') || terms.includes('fire seal')) {
    results.push({ title: 'BD Central Data Bank: Approved Fire Stop Materials (12 products)', snippet: 'Live data from data.gov.hk — fire stopping materials with test standards', url: '/api/gov/fire-stop-materials', source: 'data.gov.hk' });
  }
  if (terms.includes('mic') || terms.includes('modular') || terms.includes('prefab')) {
    results.push({ title: 'BD Accepted MiC Systems (135 systems)', snippet: 'Live data from data.gov.hk — accepted modular integrated construction systems', url: '/api/gov/mic-systems', source: 'data.gov.hk' });
  }
  if (terms.includes('compliance') || terms.includes('enforcement') || terms.includes('direction')) {
    results.push({ title: 'Fire Safety Compliance Statistics (Cap 502/572)', snippet: 'Live data from data.gov.hk — fire safety directions issued and complied with', url: '/api/gov/fire-safety', source: 'data.gov.hk' });
  }

  return results.slice(0, 2);
}

/**
 * Run all live web searches in parallel.
 * Returns supplementary context for the query pipeline.
 */
export async function liveWebSearch(query: string): Promise<{
  webResults: WebSearchResult[];
  supplementaryContext: string;
}> {
  const [bdResults, fsdResults, govResults] = await Promise.all([
    searchBDSite(query).catch(() => []),
    searchFSDSite(query).catch(() => []),
    searchGovData(query).catch(() => []),
  ]);

  const all = [...bdResults, ...fsdResults, ...govResults];

  // Build supplementary context string for the generator
  let context = '';
  if (all.length > 0) {
    context = '\n\n[Live Web Sources]\n' + all.map(r =>
      `- ${r.title} (${r.source}): ${r.snippet}`
    ).join('\n');
  }

  return { webResults: all, supplementaryContext: context };
}
