import type { RegulationSource } from './buildings-dept.js';

export const HA_BASE = 'https://www.housingauthority.gov.hk';

export const HA_SPEC_CATEGORIES = [
  'Preliminaries',
  'Architectural',
  'Drainage & External Works',
  'Structural Engineering',
  'Demolition',
  'Foundation',
  'Soft Landscape',
  'Building Services',
  'Civil Engineering',
  'Geotechnical Engineering',
] as const;

export const HA_SPEC_INDEX = `${HA_BASE}/en/business/tenders-and-contracts/specification-library`;

export function makeHASource(name: string, url: string, category: string): RegulationSource {
  return {
    name,
    url,
    version: 'current',
    department: 'HA',
    type: 'code_of_practice',
    category,
  };
}
