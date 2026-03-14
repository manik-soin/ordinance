export interface RegulationSource {
  name: string;
  url: string;
  version: string;
  department: string;
  type: 'code_of_practice' | 'design_manual' | 'practice_note' | 'circular_letter' | 'ordinance';
  category: string;
}

export const BD_BASE = 'https://www.bd.gov.hk';

export const BD_CODES_OF_PRACTICE: RegulationSource[] = [
  {
    name: 'Code of Practice for Fire Safety in Buildings',
    url: `${BD_BASE}/doc/en/resources/codes-and-references/code-and-design-manuals/fs_code2011.pdf`,
    version: '2011 (2024 Edition)',
    department: 'BD',
    type: 'code_of_practice',
    category: 'fire_safety',
  },
  {
    name: 'Code of Practice for Structural Use of Concrete',
    url: `${BD_BASE}/doc/en/resources/codes-and-references/code-and-design-manuals/CoP_SUC2013e.pdf`,
    version: '2013 (2020 Edition)',
    department: 'BD',
    type: 'code_of_practice',
    category: 'structural',
  },
  {
    name: 'Code of Practice for Structural Use of Steel',
    url: `${BD_BASE}/doc/en/resources/codes-and-references/code-and-design-manuals/SUOS2011.pdf`,
    version: '2011 (2023 Edition)',
    department: 'BD',
    type: 'code_of_practice',
    category: 'structural',
  },
  {
    name: 'Code of Practice for Foundations',
    url: `${BD_BASE}/doc/en/resources/codes-and-references/code-and-design-manuals/FoundationCode2017.pdf`,
    version: '2017 (2024 Edition)',
    department: 'BD',
    type: 'code_of_practice',
    category: 'geotechnical',
  },
  {
    name: 'Code of Practice on Wind Effects',
    url: `${BD_BASE}/doc/en/resources/codes-and-references/code-and-design-manuals/WindEffects2019e.pdf`,
    version: '2019',
    department: 'BD',
    type: 'code_of_practice',
    category: 'structural',
  },
  {
    name: 'Code of Practice for Fire Resisting Construction',
    url: `${BD_BASE}/doc/en/resources/codes-and-references/code-and-design-manuals/FRC1996_e.pdf`,
    version: '1996',
    department: 'BD',
    type: 'code_of_practice',
    category: 'fire_safety',
  },
  {
    name: 'Code of Practice for Dead and Imposed Loads',
    url: `${BD_BASE}/doc/en/resources/codes-and-references/code-and-design-manuals/DIL2011e.pdf`,
    version: '2011 (2021 Edition)',
    department: 'BD',
    type: 'code_of_practice',
    category: 'structural',
  },
  {
    name: 'Code of Practice for Demolition of Buildings',
    url: `${BD_BASE}/doc/en/resources/codes-and-references/code-and-design-manuals/Demolition_e2004.pdf`,
    version: '2004',
    department: 'BD',
    type: 'code_of_practice',
    category: 'demolition',
  },
  {
    name: 'Code of Practice for Site Supervision',
    url: `${BD_BASE}/doc/en/resources/codes-and-references/code-and-design-manuals/SS2009_e.pdf`,
    version: '2009 (2024 Edition)',
    department: 'BD',
    type: 'code_of_practice',
    category: 'supervision',
  },
  {
    name: 'Code of Practice for Structural Use of Glass',
    url: `${BD_BASE}/doc/en/resources/codes-and-references/code-and-design-manuals/SUG2018e.pdf`,
    version: '2018',
    department: 'BD',
    type: 'code_of_practice',
    category: 'structural',
  },
  {
    name: 'Code of Practice for Building Works for Lifts and Escalators',
    url: `${BD_BASE}/doc/en/resources/codes-and-references/code-and-design-manuals/BWLE2020e.pdf`,
    version: '2011 (2020 Edition)',
    department: 'BD',
    type: 'code_of_practice',
    category: 'mep',
  },
  {
    name: 'Design Manual - Barrier Free Access',
    url: `${BD_BASE}/doc/en/resources/codes-and-references/code-and-design-manuals/BFA2008_e.pdf`,
    version: '2008 (2025 Edition)',
    department: 'BD',
    type: 'design_manual',
    category: 'accessibility',
  },
];

export const BD_PNAP_INDEX = `${BD_BASE}/en/resources/codes-and-references/practice-notes-and-circular-letters/index.html`;
