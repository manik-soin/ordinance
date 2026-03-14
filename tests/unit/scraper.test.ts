import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  computeHash,
  fetchPdf,
  fetchAndDetectChange,
  storePdf,
  discoverPnapUrls,
  NotFoundError,
} from '../../src/scraper/index.js';
import type { RegulationSource } from '../../src/sources/buildings-dept.js';

const makeSource = (overrides: Partial<RegulationSource> = {}): RegulationSource => ({
  name: 'Code of Practice for Fire Safety',
  url: 'https://www.bd.gov.hk/doc/test.pdf',
  version: '2024',
  department: 'BD',
  type: 'code_of_practice',
  category: 'fire_safety',
  ...overrides,
});

describe('HK Regulation Scraper', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('computeHash', () => {
    it('returns consistent SHA-256 hash for same content', () => {
      const buffer = Buffer.from('test content');
      const hash1 = computeHash(buffer);
      const hash2 = computeHash(buffer);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('returns different hash for different content', () => {
      const hash1 = computeHash(Buffer.from('content A'));
      const hash2 = computeHash(Buffer.from('content B'));
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('URL Discovery', () => {
    it('defines all BD codes of practice PDF URLs', async () => {
      const { BD_CODES_OF_PRACTICE } = await import('../../src/sources/buildings-dept.js');
      expect(BD_CODES_OF_PRACTICE.length).toBeGreaterThanOrEqual(12);

      for (const code of BD_CODES_OF_PRACTICE) {
        expect(code.url).toMatch(/\.pdf$/);
        expect(code.department).toBe('BD');
        expect(code.name).toBeTruthy();
        expect(code.version).toBeTruthy();
      }
    });

    it('defines e-Legislation sources with cap numbers', async () => {
      const { LEGISLATION_SOURCES } = await import('../../src/sources/e-legislation.js');
      expect(LEGISLATION_SOURCES.length).toBeGreaterThanOrEqual(13);

      for (const source of LEGISLATION_SOURCES) {
        expect(source.cap).toBeTruthy();
        expect(source.url).toContain('elegislation.gov.hk');
      }
    });

    it('defines Housing Authority specification categories', async () => {
      const { HA_SPEC_CATEGORIES } = await import('../../src/sources/housing-authority.js');
      expect(HA_SPEC_CATEGORIES.length).toBe(10);
      expect(HA_SPEC_CATEGORIES).toContain('Architectural');
      expect(HA_SPEC_CATEGORIES).toContain('Structural Engineering');
    });
  });

  describe('Change Detection', () => {
    it('detects when content hash differs from stored hash', () => {
      const buffer = Buffer.from('updated content');
      const currentHash = computeHash(buffer);
      const previousHash = 'old-hash-value';
      expect(currentHash).not.toBe(previousHash);
    });

    it('returns same hash when content is unchanged', () => {
      const content = 'unchanged content';
      const hash1 = computeHash(Buffer.from(content));
      const hash2 = computeHash(Buffer.from(content));
      expect(hash1).toBe(hash2);
    });
  });

  describe('PDF Fetching', () => {
    it('throws NotFoundError on 404', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(fetchPdf('https://example.com/missing.pdf')).rejects.toThrow(
        NotFoundError
      );
    });

    it('retries on network failure (max 3)', async () => {
      let attempts = 0;

      globalThis.fetch = vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)),
        });
      });

      const result = await fetchPdf('https://example.com/test.pdf');
      expect(attempts).toBe(3);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('returns buffer and hash on successful fetch', async () => {
      const testContent = new TextEncoder().encode('PDF content here');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(testContent.buffer),
      });

      const result = await fetchPdf('https://example.com/test.pdf');
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('storePdf', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scraper-test-'));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('creates the storage directory if it does not exist', async () => {
      const nestedDir = path.join(tmpDir, 'nested', 'deep');
      const source = makeSource();
      const buffer = Buffer.from('fake pdf content');

      const filePath = await storePdf(buffer, nestedDir, source);

      const stat = await fs.stat(nestedDir);
      expect(stat.isDirectory()).toBe(true);
      expect(filePath).toContain(nestedDir);
    });

    it('writes the PDF file to disk with correct content', async () => {
      const source = makeSource();
      const buffer = Buffer.from('pdf-binary-data');

      const filePath = await storePdf(buffer, tmpDir, source);
      const written = await fs.readFile(filePath);

      expect(written).toEqual(buffer);
    });

    it('generates filename from department and sanitized name', async () => {
      const source = makeSource({ name: 'Fire Safety (2024 Ed.)' });
      const buffer = Buffer.from('data');

      const filePath = await storePdf(buffer, tmpDir, source);
      const filename = path.basename(filePath);

      // Special chars like () and . should be stripped; spaces become _
      expect(filename).toBe('BD_Fire_Safety_2024_Ed.pdf');
      expect(filename).not.toContain('(');
      expect(filename).not.toContain(')');
    });

    it('handles source name with only alphanumeric characters', async () => {
      const source = makeSource({ name: 'Simple Name', department: 'HA' });
      const buffer = Buffer.from('data');

      const filePath = await storePdf(buffer, tmpDir, source);
      const filename = path.basename(filePath);

      expect(filename).toBe('HA_Simple_Name.pdf');
    });

    it('returns the full file path', async () => {
      const source = makeSource();
      const buffer = Buffer.from('data');

      const filePath = await storePdf(buffer, tmpDir, source);

      expect(path.isAbsolute(filePath)).toBe(true);
      expect(filePath.endsWith('.pdf')).toBe(true);
    });
  });

  describe('discoverPnapUrls', () => {
    it('extracts absolute PDF URLs from href attributes', async () => {
      const html = `
        <html>
          <body>
            <a href="https://www.bd.gov.hk/doc/pnap1.pdf">PNAP 1</a>
            <a href="https://www.bd.gov.hk/doc/pnap2.pdf">PNAP 2</a>
          </body>
        </html>
      `;

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(html),
      });

      const urls = await discoverPnapUrls('https://www.bd.gov.hk/index.html');

      expect(urls).toHaveLength(2);
      expect(urls).toContain('https://www.bd.gov.hk/doc/pnap1.pdf');
      expect(urls).toContain('https://www.bd.gov.hk/doc/pnap2.pdf');
    });

    it('prepends bd.gov.hk domain for root-relative PDF hrefs', async () => {
      const html = `
        <html>
          <body>
            <a href="/doc/en/pnap123.pdf">PNAP 123</a>
            <a href="/doc/en/pnap456.pdf">PNAP 456</a>
          </body>
        </html>
      `;

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(html),
      });

      const urls = await discoverPnapUrls('https://www.bd.gov.hk/index.html');

      expect(urls).toHaveLength(2);
      expect(urls[0]).toBe('https://www.bd.gov.hk/doc/en/pnap123.pdf');
      expect(urls[1]).toBe('https://www.bd.gov.hk/doc/en/pnap456.pdf');
    });

    it('deduplicates PDF URLs', async () => {
      const html = `
        <html>
          <body>
            <a href="https://www.bd.gov.hk/doc/pnap1.pdf">Link 1</a>
            <a href="https://www.bd.gov.hk/doc/pnap1.pdf">Duplicate Link</a>
            <a href="/doc/pnap2.pdf">Link 2</a>
          </body>
        </html>
      `;

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(html),
      });

      const urls = await discoverPnapUrls('https://www.bd.gov.hk/index.html');

      expect(urls).toHaveLength(2);
    });

    it('returns empty array when no PDF links exist', async () => {
      const html = `
        <html>
          <body>
            <a href="https://www.bd.gov.hk/page.html">Not a PDF</a>
            <a href="/doc/image.png">Also not a PDF</a>
          </body>
        </html>
      `;

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(html),
      });

      const urls = await discoverPnapUrls('https://www.bd.gov.hk/index.html');

      expect(urls).toEqual([]);
    });

    it('throws on non-OK HTTP response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      await expect(discoverPnapUrls('https://www.bd.gov.hk/index.html')).rejects.toThrow(
        /Failed to fetch PNAP index/
      );
    });

    it('ignores relative hrefs that do not start with / or http', async () => {
      const html = `
        <html>
          <body>
            <a href="relative/path/doc.pdf">Relative</a>
            <a href="https://www.bd.gov.hk/absolute.pdf">Absolute</a>
          </body>
        </html>
      `;

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(html),
      });

      const urls = await discoverPnapUrls('https://www.bd.gov.hk/index.html');

      // Only the absolute URL should be included; relative without leading / is skipped
      expect(urls).toHaveLength(1);
      expect(urls[0]).toBe('https://www.bd.gov.hk/absolute.pdf');
    });
  });

  describe('fetchAndDetectChange', () => {
    it('reports changed=true when previous hash differs from current', async () => {
      const pdfContent = new TextEncoder().encode('new version of the pdf');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(pdfContent.buffer),
      });

      const source = makeSource();
      const result = await fetchAndDetectChange(source, 'old-stale-hash');

      expect(result.changed).toBe(true);
      expect(result.previousHash).toBe('old-stale-hash');
      expect(result.currentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.currentHash).not.toBe('old-stale-hash');
      expect(result.source).toBe(source);
      expect(result.fetchedAt).toBeInstanceOf(Date);
    });

    it('reports changed=false when previous hash matches current', async () => {
      const pdfContent = Buffer.from('stable content');
      const expectedHash = computeHash(pdfContent);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(pdfContent.buffer.slice(
          pdfContent.byteOffset,
          pdfContent.byteOffset + pdfContent.byteLength
        )),
      });

      const source = makeSource();
      const result = await fetchAndDetectChange(source, expectedHash);

      expect(result.changed).toBe(false);
      expect(result.currentHash).toBe(expectedHash);
      expect(result.previousHash).toBe(expectedHash);
    });

    it('reports changed=true when previousHash is null (first fetch)', async () => {
      const pdfContent = new TextEncoder().encode('brand new pdf');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(pdfContent.buffer),
      });

      const source = makeSource();
      const result = await fetchAndDetectChange(source, null);

      expect(result.changed).toBe(true);
      expect(result.previousHash).toBeNull();
      expect(result.currentHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('propagates fetch errors', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const source = makeSource();
      await expect(fetchAndDetectChange(source, null)).rejects.toThrow(NotFoundError);
    });
  });
});
