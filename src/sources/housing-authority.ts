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

/**
 * Housing Authority codes of practice and specifications.
 */
export const HA_SOURCES: RegulationSource[] = [
  {
    name: 'General Specification for Building Works 2024 Edition',
    url: `${HA_BASE}/common/pdf/business-partnerships/resources/general-specification-for-building-works/General%20Specification%20for%20Building%20Works%202024%20Edition.pdf`,
    version: '2024',
    department: 'HA',
    type: 'code_of_practice',
    category: 'building_standards',
  },
  {
    name: 'Specification Library 2022 Edition',
    url: `${HA_BASE}/common/pdf/business-partnerships/resources/specification-library/SL2022_052022_31052023_Orginal_OGCIO_V3.pdf`,
    version: '2022',
    department: 'HA',
    type: 'code_of_practice',
    category: 'specification_library',
  },
  {
    name: 'General Conditions of Contract for Building Works',
    url: `${HA_BASE}/common/pdf/business-partnerships/resources/general-conditions-of-contract-for-capital-works/Building-GCC.pdf`,
    version: 'current',
    department: 'HA',
    type: 'code_of_practice',
    category: 'contract_conditions',
  },
  {
    name: 'General Conditions of Contract for Foundation Works',
    url: `${HA_BASE}/common/pdf/business-partnerships/resources/general-conditions-of-contract-for-capital-works/Foundation-GCC.pdf`,
    version: 'current',
    department: 'HA',
    type: 'code_of_practice',
    category: 'contract_conditions',
  },
  {
    name: 'BIM Standards Manual',
    url: `${HA_BASE}/sc/common/pdf/business-partnerships/resources/building-information-modelling/standardsmanual.pdf`,
    version: 'current',
    department: 'HA',
    type: 'design_manual',
    category: 'bim',
  },
];
