import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { RegulationSource } from '../sources/buildings-dept.js';

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
          'User-Agent': 'HK-Compliance-RAG/1.0 (research)',
          Accept: 'application/pdf',
        },
        signal: AbortSignal.timeout(60_000),
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
      if (attempt < maxRetries) {
        await sleep(1000 * attempt); // linear backoff
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
