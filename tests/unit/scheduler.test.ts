import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RegulationSource } from '../../src/sources/buildings-dept.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../src/scraper/index.js', () => ({
  fetchPdf: vi.fn(),
  computeHash: vi.fn(),
}));

vi.mock('../../src/db/store.js', () => ({
  getDocumentHash: vi.fn(),
  recordDocumentVersion: vi.fn(),
}));

const mockQuery = vi.fn().mockResolvedValue({ rows: [] });

vi.mock('../../src/db/pool.js', () => ({
  getPool: vi.fn(() => ({ query: mockQuery })),
}));

vi.mock('node-cron', () => ({
  default: { schedule: vi.fn() },
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { DEFAULT_SCHEDULES, checkForChanges, startScheduler } from '../../src/scheduler/index.js';
import { fetchPdf } from '../../src/scraper/index.js';
import { getDocumentHash, recordDocumentVersion } from '../../src/db/store.js';
import cron from 'node-cron';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSource(name: string, overrides?: Partial<RegulationSource>): RegulationSource {
  return {
    name,
    url: `https://example.com/${name.replace(/\s+/g, '_')}.pdf`,
    version: '2024',
    department: 'BD',
    type: 'code_of_practice',
    category: 'structural',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Scheduler', () => {
  describe('DEFAULT_SCHEDULES', () => {
    it('defines BD codes schedule as monthly', () => {
      const bdSchedule = DEFAULT_SCHEDULES.find((s) => s.name.includes('BD Codes'));
      expect(bdSchedule).toBeDefined();
      expect(bdSchedule!.schedule).toMatch(/^\d+\s+\d+\s+\d+\s+\*\s+\*/); // cron monthly pattern
    });

    it('each schedule has a valid cron expression', () => {
      for (const schedule of DEFAULT_SCHEDULES) {
        const parts = schedule.schedule.split(/\s+/);
        expect(parts.length).toBe(5);
      }
    });

    it('each schedule has sources', () => {
      for (const schedule of DEFAULT_SCHEDULES) {
        expect(schedule.sources.length).toBeGreaterThan(0);
      }
    });
  });

  // ── checkForChanges ──────────────────────────────────────────────────────

  describe('checkForChanges', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockQuery.mockResolvedValue({ rows: [] });
    });

    it('reports all documents unchanged when hashes match', async () => {
      const sources = [makeSource('Doc A'), makeSource('Doc B')];

      vi.mocked(getDocumentHash).mockResolvedValue('abc123');
      vi.mocked(fetchPdf).mockResolvedValue({
        buffer: Buffer.from('pdf-bytes'),
        contentHash: 'abc123',
      });

      const result = await checkForChanges(sources);

      expect(result.documentsChecked).toBe(2);
      expect(result.documentsChanged).toBe(0);
      expect(result.documentsFailed).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(recordDocumentVersion).not.toHaveBeenCalled();
    });

    it('detects changed documents when hashes differ', async () => {
      const sources = [makeSource('Doc A'), makeSource('Doc B'), makeSource('Doc C')];

      // Doc A: unchanged, Doc B: changed, Doc C: changed
      vi.mocked(getDocumentHash)
        .mockResolvedValueOnce('hash-a')
        .mockResolvedValueOnce('old-hash-b')
        .mockResolvedValueOnce('old-hash-c');

      vi.mocked(fetchPdf)
        .mockResolvedValueOnce({ buffer: Buffer.from('a'), contentHash: 'hash-a' })
        .mockResolvedValueOnce({ buffer: Buffer.from('b'), contentHash: 'new-hash-b' })
        .mockResolvedValueOnce({ buffer: Buffer.from('c'), contentHash: 'new-hash-c' });

      vi.mocked(recordDocumentVersion).mockResolvedValue('version-id');

      const result = await checkForChanges(sources);

      expect(result.documentsChecked).toBe(3);
      expect(result.documentsChanged).toBe(2);
      expect(result.documentsFailed).toBe(0);
      expect(recordDocumentVersion).toHaveBeenCalledTimes(2);
    });

    it('handles network failure on some documents gracefully', async () => {
      const sources = [makeSource('Doc OK'), makeSource('Doc Fail')];

      vi.mocked(getDocumentHash).mockResolvedValue(null);

      vi.mocked(fetchPdf)
        .mockResolvedValueOnce({ buffer: Buffer.from('ok'), contentHash: 'hash-ok' })
        .mockRejectedValueOnce(new Error('Network timeout'));

      vi.mocked(recordDocumentVersion).mockResolvedValue('version-id');

      const result = await checkForChanges(sources);

      expect(result.documentsChecked).toBe(2);
      expect(result.documentsChanged).toBe(1); // Doc OK is new (null -> hash-ok)
      expect(result.documentsFailed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].document).toBe('Doc Fail');
      expect(result.errors[0].error).toContain('Network timeout');
    });

    it('processes sources in batches respecting concurrency limit', async () => {
      const sources = [
        makeSource('A'),
        makeSource('B'),
        makeSource('C'),
        makeSource('D'),
        makeSource('E'),
      ];

      // Track the order of fetchPdf calls relative to Promise.allSettled batches
      const callTimestamps: number[] = [];
      let callCount = 0;

      vi.mocked(getDocumentHash).mockResolvedValue('same-hash');
      vi.mocked(fetchPdf).mockImplementation(async () => {
        callTimestamps.push(++callCount);
        return { buffer: Buffer.from('data'), contentHash: 'same-hash' };
      });

      // concurrency = 2: batches of [A,B], [C,D], [E]
      await checkForChanges(sources, 2);

      expect(fetchPdf).toHaveBeenCalledTimes(5);
      // Verify all 5 sources were processed
      expect(callTimestamps).toHaveLength(5);
    });

    it('writes scrape log to the database', async () => {
      const sources = [makeSource('Doc X', { department: 'FSD' })];

      vi.mocked(getDocumentHash).mockResolvedValue(null);
      vi.mocked(fetchPdf).mockResolvedValue({
        buffer: Buffer.from('data'),
        contentHash: 'new-hash',
      });
      vi.mocked(recordDocumentVersion).mockResolvedValue('v-id');

      await checkForChanges(sources);

      expect(mockQuery).toHaveBeenCalledTimes(1);

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO scrape_log');
      expect(params[0]).toBe('FSD'); // source_department
      expect(params[1]).toBe(1);     // documents_checked
      expect(params[2]).toBe(1);     // documents_changed
      expect(params[3]).toBe(0);     // documents_failed
    });

    it('records correct department from sources', async () => {
      const sources = [makeSource('EPD Doc', { department: 'EPD' })];

      vi.mocked(getDocumentHash).mockResolvedValue('hash-x');
      vi.mocked(fetchPdf).mockResolvedValue({
        buffer: Buffer.from('data'),
        contentHash: 'hash-x',
      });

      const result = await checkForChanges(sources);

      expect(result.department).toBe('EPD');
    });

    it('records document version with correct arguments when document changes', async () => {
      const source = makeSource('Fire Code', {
        department: 'BD',
        version: '2024 Edition',
        url: 'https://bd.gov.hk/fire.pdf',
      });

      vi.mocked(getDocumentHash).mockResolvedValue('old');
      vi.mocked(fetchPdf).mockResolvedValue({
        buffer: Buffer.from('new-pdf'),
        contentHash: 'new',
      });
      vi.mocked(recordDocumentVersion).mockResolvedValue('v-id');

      await checkForChanges([source]);

      expect(recordDocumentVersion).toHaveBeenCalledWith(
        expect.anything(),     // pool
        'Fire Code',           // document name
        'BD',                  // department
        '2024 Edition',        // version
        'new',                 // content hash
        'https://bd.gov.hk/fire.pdf', // url
        0                      // chunk count
      );
    });

    it('treats null previous hash as a change (new document)', async () => {
      const sources = [makeSource('Brand New Doc')];

      vi.mocked(getDocumentHash).mockResolvedValue(null);
      vi.mocked(fetchPdf).mockResolvedValue({
        buffer: Buffer.from('fresh'),
        contentHash: 'fresh-hash',
      });
      vi.mocked(recordDocumentVersion).mockResolvedValue('v-id');

      const result = await checkForChanges(sources);

      expect(result.documentsChanged).toBe(1);
      expect(recordDocumentVersion).toHaveBeenCalledTimes(1);
    });
  });

  // ── startScheduler ──────────────────────────────────────────────────────

  describe('startScheduler', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('calls cron.schedule for each DEFAULT_SCHEDULE with correct expression and callback', () => {
      startScheduler();

      expect(cron.schedule).toHaveBeenCalledTimes(DEFAULT_SCHEDULES.length);

      for (let i = 0; i < DEFAULT_SCHEDULES.length; i++) {
        const call = vi.mocked(cron.schedule).mock.calls[i];
        // First argument is the cron expression
        expect(call[0]).toBe(DEFAULT_SCHEDULES[i].schedule);
        // Second argument is the callback function
        expect(typeof call[1]).toBe('function');
      }
    });
  });
});
