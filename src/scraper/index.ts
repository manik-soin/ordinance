import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import type { RegulationSource } from '../sources/buildings-dept.js';

const dohCache = new Map<string, string>();

/**
 * Resolve a hostname via DNS-over-HTTPS (Cloudflare) as fallback.
 */
async function resolveViaDoH(hostname: string): Promise<string | null> {
  if (dohCache.has(hostname)) return dohCache.get(hostname)!;
  try {
    // Try native DNS first
    const addresses = await dns.resolve4(hostname);
    if (addresses.length > 0) return addresses[0];
  } catch {
    // Native DNS failed, try DoH
  }
  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
      { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(10_000) }
    );
    const data = await res.json() as { Answer?: Array<{ type: number; data: string }> };
    const aRecord = data.Answer?.find((r: { type: number }) => r.type === 1);
    if (aRecord) {
      dohCache.set(hostname, aRecord.data);
      return aRecord.data;
    }
  } catch {}
  return null;
}

/**
 * Create an HTTPS agent that resolves via DoH when needed.
 */
function createDoHAgent(hostname: string, ip: string): https.Agent {
  return new https.Agent({
    lookup: (_hostname, _options, callback) => {
      callback(null, ip, 4);
    },
  });
}

export interface FetchResult {
  source: RegulationSource;
  buffer: Buffer;
  contentHash: string;
  fetchedAt: Date;
}

export interface ChangeDetectionResult {
  source: RegulationSource;
  changed: boolean;
  previousHash: string | null;
  currentHash: string;
  fetchedAt: Date;
}

/**
 * Compute SHA-256 hash of a buffer.
 */
export function computeHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Fetch a PDF from a URL with retry logic.
 */
export async function fetchPdf(
  url: string,
  maxRetries = 3
): Promise<{ buffer: Buffer; contentHash: string }> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          Accept: 'application/pdf',
        },
        signal: AbortSignal.timeout(120_000),
      });

      if (response.status === 404) {
        throw new NotFoundError(`PDF not found: ${url}`);
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const contentHash = computeHash(buffer);

      return { buffer, contentHash };
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));

      // On DNS/network failure for .gov.hk, try DoH fallback
      const parsedUrl = new URL(url);
      if (parsedUrl.hostname.endsWith('.gov.hk') && lastError.message.includes('fetch failed')) {
        const dohIp = await resolveViaDoH(parsedUrl.hostname);
        if (dohIp) {
          console.log(`[Fetch] Resolved ${parsedUrl.hostname} → ${dohIp} via DoH`);
          try {
            return await fetchWithCustomDns(url, dohIp);
          } catch (dohErr) {
            lastError = dohErr instanceof Error ? dohErr : new Error(String(dohErr));
          }
        }
      }

      if (attempt < maxRetries) {
        await sleep(1000 * attempt);
      }
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url}`);
}

/**
 * Fetch a regulation source and check for changes against a stored hash.
 */
export async function fetchAndDetectChange(
  source: RegulationSource,
  previousHash: string | null
): Promise<ChangeDetectionResult> {
  const { contentHash } = await fetchPdf(source.url);

  return {
    source,
    changed: previousHash !== contentHash,
    previousHash,
    currentHash: contentHash,
    fetchedAt: new Date(),
  };
}

/**
 * Store a PDF to the local filesystem.
 */
export async function storePdf(
  buffer: Buffer,
  storageDir: string,
  source: RegulationSource
): Promise<string> {
  await fs.mkdir(storageDir, { recursive: true });
  const safeName = source.name.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_');
  const filename = `${source.department}_${safeName}.pdf`;
  const filePath = path.join(storageDir, filename);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

/**
 * Discover PNAP PDF URLs from the BD practice notes index page.
 */
export async function discoverPnapUrls(indexUrl: string): Promise<string[]> {
  const response = await fetch(indexUrl, {
    headers: { 'User-Agent': 'HK-Compliance-RAG/1.0 (research)' },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch PNAP index: HTTP ${response.status}`);
  }

  const html = await response.text();
  const pdfUrls: string[] = [];

  // Match all href attributes pointing to PDF files
  const hrefRegex = /href=["']([^"']*\.pdf)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1];
    if (href.startsWith('http')) {
      pdfUrls.push(href);
    } else if (href.startsWith('/')) {
      pdfUrls.push(`https://www.bd.gov.hk${href}`);
    }
  }

  return [...new Set(pdfUrls)]; // deduplicate
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * Fetch a URL using node:https with a custom DNS lookup (for DoH-resolved IPs).
 * This preserves SNI so TLS works correctly.
 */
function fetchWithCustomDns(url: string, ip: string): Promise<{ buffer: Buffer; contentHash: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Accept: 'application/pdf',
      },
      lookup: ((_hostname: string, options: { all?: boolean }, cb: Function) => {
        if (options.all) {
          cb(null, [{ address: ip, family: 4 }]);
        } else {
          cb(null, ip, 4);
        }
      }) as typeof dns.lookup,
      timeout: 120_000,
    };

    const req = https.request(options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const location = res.headers.location;
        if (location) {
          fetchWithCustomDns(location, ip).then(resolve).catch(reject);
          return;
        }
      }
      if (res.statusCode === 404) {
        reject(new NotFoundError(`PDF not found: ${url}`));
        return;
      }
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const contentHash = computeHash(buffer);
        resolve({ buffer, contentHash });
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
