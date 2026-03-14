export interface LegislationSource {
  cap: string;
  name: string;
  url: string;
  department: string;
  category: string;
}

export const ELEGISLATION_BASE = 'https://www.elegislation.gov.hk/hk';

export const LEGISLATION_SOURCES: LegislationSource[] = [
  { cap: '123', name: 'Buildings Ordinance', url: `${ELEGISLATION_BASE}/cap123`, department: 'BD', category: 'primary_legislation' },
  { cap: '123A', name: 'Building (Administration) Regulations', url: `${ELEGISLATION_BASE}/cap123A`, department: 'BD', category: 'subsidiary_legislation' },
  { cap: '123B', name: 'Building (Construction) Regulations', url: `${ELEGISLATION_BASE}/cap123B`, department: 'BD', category: 'subsidiary_legislation' },
  { cap: '123F', name: 'Building (Planning) Regulations', url: `${ELEGISLATION_BASE}/cap123F`, department: 'BD', category: 'subsidiary_legislation' },
  { cap: '123I', name: 'Building (Standards of Sanitary Fitments) Regulations', url: `${ELEGISLATION_BASE}/cap123I`, department: 'BD', category: 'subsidiary_legislation' },
  { cap: '572', name: 'Fire Safety (Buildings) Ordinance', url: `${ELEGISLATION_BASE}/cap572`, department: 'FSD', category: 'primary_legislation' },
  { cap: '502', name: 'Fire Safety (Commercial Premises) Ordinance', url: `${ELEGISLATION_BASE}/cap502`, department: 'FSD', category: 'primary_legislation' },
  { cap: '400', name: 'Noise Control Ordinance', url: `${ELEGISLATION_BASE}/cap400`, department: 'EPD', category: 'primary_legislation' },
  { cap: '311', name: 'Air Pollution Control Ordinance', url: `${ELEGISLATION_BASE}/cap311`, department: 'EPD', category: 'primary_legislation' },
  { cap: '354', name: 'Waste Disposal Ordinance', url: `${ELEGISLATION_BASE}/cap354`, department: 'EPD', category: 'primary_legislation' },
  { cap: '499', name: 'Environmental Impact Assessment Ordinance', url: `${ELEGISLATION_BASE}/cap499`, department: 'EPD', category: 'primary_legislation' },
  { cap: '406', name: 'Electricity Ordinance', url: `${ELEGISLATION_BASE}/cap406`, department: 'EMSD', category: 'primary_legislation' },
  { cap: '618', name: 'Lifts and Escalators Ordinance', url: `${ELEGISLATION_BASE}/cap618`, department: 'EMSD', category: 'primary_legislation' },
];
