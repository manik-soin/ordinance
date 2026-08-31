import type { ProjectMemory } from './types.js';

/**
 * Durable project memory: small structured facts about the user's project
 * (building type, storey count, use class) pinned into the working context
 * instead of replaying raw chat history. Extraction is heuristic — regex
 * over the query text — so it costs microseconds and no tokens.
 */

const BUILDING_TYPES = [
  'residential',
  'domestic',
  'commercial',
  'industrial',
  'composite',
  'office',
  'hotel',
  'school',
  'hospital',
  'warehouse',
  'godown',
  'institutional',
  'retail',
] as const;

/** Extract project facts mentioned in a single query. */
export function extractProjectMemory(query: string): ProjectMemory {
  const q = query.toLowerCase();
  const memory: ProjectMemory = {};

  const storeyMatch = q.match(/(\d{1,3})\s*-?\s*store(?:y|ys|ies)/);
  if (storeyMatch) {
    const storeys = parseInt(storeyMatch[1], 10);
    if (storeys > 0 && storeys < 200) memory.storeys = storeys;
  }

  for (const type of BUILDING_TYPES) {
    if (q.includes(`${type} building`) || q.includes(`${type} development`) || q.includes(`my ${type}`)) {
      memory.buildingType = type;
      break;
    }
  }

  const useClassMatch = q.match(/use\s+class\s+([a-z0-9]+)/i);
  if (useClassMatch) memory.useClass = useClassMatch[1].toUpperCase();

  const areaMatch = q.match(/([\d,]+)\s*(?:m2|m²|sq\.?\s?m|square met(?:re|er)s?)/);
  if (areaMatch) {
    const area = parseInt(areaMatch[1].replace(/,/g, ''), 10);
    if (area > 0) memory.siteAreaSqm = area;
  }

  return memory;
}

/** Merge newly extracted facts over prior memory — newest mention wins per field. */
export function mergeProjectMemory(
  prior: ProjectMemory | undefined,
  extracted: ProjectMemory
): ProjectMemory {
  return {
    ...(prior ?? {}),
    ...Object.fromEntries(
      Object.entries(extracted).filter(([, v]) => v !== undefined)
    ),
  };
}

/** True when memory carries at least one pinned fact. */
export function hasMemory(memory: ProjectMemory | undefined): boolean {
  if (!memory) return false;
  return (
    memory.buildingType !== undefined ||
    memory.storeys !== undefined ||
    memory.useClass !== undefined ||
    memory.siteAreaSqm !== undefined ||
    (memory.notes?.length ?? 0) > 0
  );
}

/** Render memory as a compact pinned block for the working context. */
export function renderMemory(memory: ProjectMemory): string {
  const facts: string[] = [];
  if (memory.buildingType) facts.push(`building type: ${memory.buildingType}`);
  if (memory.storeys !== undefined) facts.push(`storeys: ${memory.storeys}`);
  if (memory.useClass) facts.push(`use class: ${memory.useClass}`);
  if (memory.siteAreaSqm !== undefined) facts.push(`site area: ${memory.siteAreaSqm} m2`);
  if (memory.notes?.length) facts.push(`notes: ${memory.notes.join('; ')}`);
  return facts.length > 0 ? `PROJECT MEMORY (durable facts from this session):\n${facts.join('\n')}` : '';
}
