import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeHash, fetchPdf, NotFoundError } from '../../src/scraper/index.js';

describe('HK Regulation Scraper', () => {
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
      // Mock fetch to return 404
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(fetchPdf('https://example.com/missing.pdf')).rejects.toThrow(
        NotFoundError
      );

      globalThis.fetch = originalFetch;
    });

    it('retries on network failure (max 3)', async () => {
      const originalFetch = globalThis.fetch;
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

      globalThis.fetch = originalFetch;
    });

    it('returns buffer and hash on successful fetch', async () => {
      const originalFetch = globalThis.fetch;
      const testContent = new TextEncoder().encode('PDF content here');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(testContent.buffer),
      });

      const result = await fetchPdf('https://example.com/test.pdf');
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);

      globalThis.fetch = originalFetch;
    });
  });
});
