import type { SearchFilter } from './hybrid-search.js';

/**
 * Route a query to the most likely regulatory domain based on keyword analysis.
 * Returns a SearchFilter to narrow retrieval, reducing noise and improving precision.
 *
 * Only applies a filter when confidence is high — ambiguous queries search everything.
 */
export function routeQuery(query: string): SearchFilter | undefined {
  const q = query.toLowerCase();

  // Department detection — high-confidence keyword matching
  const departmentSignals: Array<{ dept: string; keywords: string[]; weight: number }> = [
    { dept: 'FSD', keywords: ['fire service', 'fsd', 'fire protection notice', 'fpn', 'fire extinguish', 'sprinkler system', 'fire alarm', 'hose reel', 'fire hydrant'], weight: 0 },
    { dept: 'EPD', keywords: ['environmental', 'epd', 'noise control', 'air quality', 'water pollution', 'waste disposal', 'environmental impact'], weight: 0 },
    { dept: 'EMSD', keywords: ['emsd', 'electrical', 'gas safety', 'lift and escalator', 'electricity ordinance'], weight: 0 },
    { dept: 'HA', keywords: ['housing authority', 'public housing', 'public rental', 'home ownership'], weight: 0 },
  ];

  for (const signal of departmentSignals) {
    signal.weight = signal.keywords.filter(kw => q.includes(kw)).length;
  }

  const topDept = departmentSignals.reduce((a, b) => a.weight > b.weight ? a : b);

  // Only filter if there's a strong signal (2+ keyword matches) for a non-BD department.
  // BD is the default — most building regulation questions go there, so we don't filter for it.
  if (topDept.weight >= 2) {
    return { department: topDept.dept as SearchFilter['department'] };
  }

  // Document type detection for BD queries
  const docTypeSignals: Array<{ type: string; keywords: string[] }> = [
    { type: 'practice_note', keywords: ['pnap', 'practice note', 'app-', 'adv-'] },
    { type: 'ordinance', keywords: ['ordinance', 'cap.', 'cap ', 'section ', 'regulation '] },
  ];

  for (const signal of docTypeSignals) {
    const matches = signal.keywords.filter(kw => q.includes(kw)).length;
    if (matches >= 2) {
      return { documentType: signal.type as SearchFilter['documentType'] };
    }
  }

  // No confident routing — search everything
  return undefined;
}
