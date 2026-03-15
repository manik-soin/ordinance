/**
 * HK Government Open Data API integrations.
 * Fetches live data from data.gov.hk (BD datasets) and geodata.gov.hk.
 */

const BD_DATA_BASE = 'https://static.data.gov.hk/bd/opendata';
const GEODATA_BASE = 'https://geodata.gov.hk/gs/api/v1.0.0';
const REQUEST_TIMEOUT = 10000;

// ─── TTL Cache for gov data (avoids hammering data.gov.hk) ──────────────────
const dataCache = new Map<string, { data: unknown; expiresAt: number }>();
const DATA_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getCached<T>(key: string): T | null {
  const cached = dataCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data as T;
  return null;
}

function setCache(key: string, data: unknown): void {
  dataCache.set(key, { data, expiresAt: Date.now() + DATA_CACHE_TTL });
}

// ─── BD Central Data Bank: Approved Building Components ──────────────────────

export interface FireDoorset {
  refNo: string;
  productName: string;
  manufacturer: string;
  integrityMinutes: string;
  insulationMinutes: string;
  testReport: string;
  validityDate: string;
}

export interface FireGlazing {
  refNo: string;
  productName: string;
  manufacturer: string;
  integrityMinutes: string;
  insulationMinutes: string;
  testReport: string;
}

export interface FireStopMaterial {
  refNo: string;
  productName: string;
  manufacturer: string;
  category: string;
  application: string;
  testStandard: string;
}

export interface MiCSystem {
  ref: string;
  manufacturer: string;
  type: string;
  modelNo: string;
  intendedUse: string;
  maxHeight: string;
  maxStorey: string;
  dateAccepted: string;
}

export interface FireSafetyCompliance {
  type: string;
  asAt: string;
  directionsIssued: string;
  directionsComplied: string;
}

/**
 * Parse CSV text into array of objects using first row as headers.
 */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, '').split('\n');
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const results: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? '';
    }
    results.push(row);
  }
  return results;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Fetch a CSV dataset from data.gov.hk (with TTL cache).
 */
async function fetchBDCsv(path: string): Promise<Record<string, string>[]> {
  const cached = getCached<Record<string, string>[]>(path);
  if (cached) return cached;

  const url = `${BD_DATA_BASE}/${path}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'HK-Compliance-RAG/1.0' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const text = await response.text();
  const result = parseCsv(text);
  setCache(path, result);
  return result;
}

/**
 * Fetch BD-approved fire resisting doorsets from Central Data Bank.
 */
export async function fetchFireDoorsets(): Promise<FireDoorset[]> {
  const rows = await fetchBDCsv('cdbbc/cdbfrd.csv');
  return rows.map((r) => ({
    refNo: r.RefNo || r.refNo || '',
    productName: r.ProductName || r.productName || '',
    manufacturer: r.NameofManufacturer || r.manufacturer || '',
    integrityMinutes: r.Integrity || '',
    insulationMinutes: r.Insulation || '',
    testReport: r.Reportno || '',
    validityDate: r.ValidityDate || '',
  }));
}

/**
 * Fetch BD-approved fire resisting glazing from Central Data Bank.
 */
export async function fetchFireGlazing(): Promise<FireGlazing[]> {
  const rows = await fetchBDCsv('cdbbc/cdbfrg.csv');
  return rows.map((r) => ({
    refNo: r.RefNo || '',
    productName: r.ProductName || '',
    manufacturer: r.NameofManufacturer || '',
    integrityMinutes: r.Integrity || '',
    insulationMinutes: r.Insulation || '',
    testReport: r.Reportno || '',
  }));
}

/**
 * Fetch BD-approved fire stop materials from Central Data Bank.
 */
export async function fetchFireStopMaterials(): Promise<FireStopMaterial[]> {
  const rows = await fetchBDCsv('cdbbm/cdbfsm.csv');
  return rows.map((r) => ({
    refNo: r.RefNo || '',
    productName: r.ProductName || '',
    manufacturer: r.NameofManufacturer || '',
    category: r.MaterialCategory || '',
    application: r.Application || '',
    testStandard: r.ComplianceTestingStandard || '',
  }));
}

/**
 * Fetch BD-accepted Modular Integrated Construction (MiC) systems.
 */
export async function fetchMiCSystems(): Promise<MiCSystem[]> {
  const rows = await fetchBDCsv('mic/mic.csv');
  return rows.map((r) => ({
    ref: r.ipa_ref || '',
    manufacturer: r.manufacturer_en || '',
    type: r.mic_type_en || '',
    modelNo: r.model_no || '',
    intendedUse: r.intended_use_en || '',
    maxHeight: r.intended_maximum_building_height || '',
    maxStorey: r.intended_maximum_storey || '',
    dateAccepted: r.date_of_acceptance || '',
  }));
}

/**
 * Fetch fire safety compliance statistics (Cap 502/572 directions).
 */
export async function fetchFireSafetyCompliance(): Promise<FireSafetyCompliance[]> {
  const rows = await fetchBDCsv('fso/fso.csv');
  return rows.map((r) => ({
    type: r.Type || '',
    asAt: r['As at'] || '',
    directionsIssued: r['Fire safety directions issue'] || r['Fire safety improvement directions issue'] || '',
    directionsComplied: r['Fire safety directions complied with/discharged'] || r['Fire safety improvement directions complied with/discharged'] || '',
  }));
}

// ─── GeoData Location Search ─────────────────────────────────────────────────

export interface LocationResult {
  nameEN: string;
  nameCH: string;
  addressEN: string;
  addressCH: string;
  districtEN: string;
  x: number;
  y: number;
}

/**
 * Search for buildings/locations by name using the GeoData API.
 */
export async function searchLocation(query: string): Promise<LocationResult[]> {
  const url = `${GEODATA_BASE}/locationSearch?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'HK-Compliance-RAG/1.0' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  if (!response.ok) return [];
  const data = (await response.json()) as LocationResult[];
  return data.slice(0, 10);
}

// ─── Combined Data Summary ───────────────────────────────────────────────────

export interface GovDataSummary {
  fireDoorsets: { count: number; sample: FireDoorset[] };
  fireGlazing: { count: number; sample: FireGlazing[] };
  fireStopMaterials: { count: number; sample: FireStopMaterial[] };
  micSystems: { count: number; sample: MiCSystem[] };
  fireSafety: { count: number; latest: FireSafetyCompliance[] };
}

/**
 * Fetch a summary of all available BD open datasets.
 */
export async function fetchGovDataSummary(): Promise<GovDataSummary> {
  const [doorsets, glazing, materials, mic, fso] = await Promise.all([
    fetchFireDoorsets().catch(() => [] as FireDoorset[]),
    fetchFireGlazing().catch(() => [] as FireGlazing[]),
    fetchFireStopMaterials().catch(() => [] as FireStopMaterial[]),
    fetchMiCSystems().catch(() => [] as MiCSystem[]),
    fetchFireSafetyCompliance().catch(() => [] as FireSafetyCompliance[]),
  ]);

  return {
    fireDoorsets: { count: doorsets.length, sample: doorsets.slice(0, 3) },
    fireGlazing: { count: glazing.length, sample: glazing.slice(0, 3) },
    fireStopMaterials: { count: materials.length, sample: materials.slice(0, 3) },
    micSystems: { count: mic.length, sample: mic.slice(0, 3) },
    fireSafety: { count: fso.length, latest: fso.slice(-4) },
  };
}
