import type { RegulationSource } from './buildings-dept.js';

export const EMSD_BASE = 'https://www.emsd.gov.hk';

/**
 * EMSD Codes of Practice and key technical guidelines.
 */
export const EMSD_CODES_OF_PRACTICE: RegulationSource[] = [
  // Electrical installations
  {
    name: 'Code of Practice for the Electricity (Wiring) Regulations 2020',
    url: `${EMSD_BASE}/filemanager/en/content_443/COP_E_2020.pdf`,
    version: '2020',
    department: 'EMSD',
    type: 'code_of_practice',
    category: 'electricity_safety',
  },

  // Energy efficiency
  {
    name: 'Code of Practice for Energy Efficiency of Building Services Installation (BEC 2024)',
    url: `${EMSD_BASE}/beeo/en/pee/BEC_2024_ENG.pdf`,
    version: '2024',
    department: 'EMSD',
    type: 'code_of_practice',
    category: 'energy_efficiency',
  },
  {
    name: 'Technical Guidelines on BEC 2024',
    url: `${EMSD_BASE}/beeo/en/pee/TG-BEC_2024.pdf`,
    version: '2024',
    department: 'EMSD',
    type: 'design_manual',
    category: 'energy_efficiency',
  },
  {
    name: 'Code of Practice for Building Energy Audit (EAC 2024)',
    url: `${EMSD_BASE}/beeo/en/pee/EAC_2024_ENG.pdf`,
    version: '2024',
    department: 'EMSD',
    type: 'code_of_practice',
    category: 'energy_efficiency',
  },
  {
    name: 'Technical Guidelines on EAC 2024',
    url: `${EMSD_BASE}/beeo/en/pee/TG-EAC_2024.pdf`,
    version: '2024',
    department: 'EMSD',
    type: 'design_manual',
    category: 'energy_efficiency',
  },

  // Lifts and escalators
  {
    name: 'Code of Practice for Lift Works and Escalator Works 2021',
    url: `${EMSD_BASE}/filemanager/en/content_805/Works%20Code_Eng_2021%20Edition.pdf`,
    version: '2021',
    department: 'EMSD',
    type: 'code_of_practice',
    category: 'lifts_escalators',
  },
  {
    name: 'Code of Practice on the Design and Construction of Builders Lifts 2021',
    url: `${EMSD_BASE}/filemanager/en/content_606/COP%20of%20BL(ENG)%20(2021E)%20protected.pdf`,
    version: '2021',
    department: 'EMSD',
    type: 'code_of_practice',
    category: 'lifts_escalators',
  },

  // Gas safety
  {
    name: 'Code of Practice for LPG Filling Stations in Hong Kong 2020',
    url: `${EMSD_BASE}/filemanager/en/content_393/LPG-Filling-Station-CoP-2020-ENG.pdf`,
    version: '2020',
    department: 'EMSD',
    type: 'code_of_practice',
    category: 'gas_safety',
  },
  {
    name: 'GU03 - Installation Requirements for Domestic Gas Water Heaters',
    url: `${EMSD_BASE}/filemanager/en/content_286/gu03.pdf`,
    version: 'current',
    department: 'EMSD',
    type: 'code_of_practice',
    category: 'gas_safety',
  },
  {
    name: 'GU21 - Requirements for Town Gas Installations',
    url: `${EMSD_BASE}/filemanager/en/content_286/GU21%20(English)%20rev.3.pdf`,
    version: 'rev.3',
    department: 'EMSD',
    type: 'code_of_practice',
    category: 'gas_safety',
  },
  {
    name: 'LPG Code of Practice Module 1 - LPG Compounds and Cylinder Stores',
    url: `${EMSD_BASE}/filemanager/en/content_286/COP%20M1_Issue%203_Eng.pdf`,
    version: 'Issue 3',
    department: 'EMSD',
    type: 'code_of_practice',
    category: 'gas_safety',
  },
];
