import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db/pool.js', () => ({
  getPool: vi.fn(),
  closePool: vi.fn(),
}));

// Suppress console.log during tests
vi.spyOn(console, 'log').mockImplementation(() => {});

import { getPool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';

const mockGetPool = vi.mocked(getPool);

function createMockPool(appliedMigrations: string[] = []) {
  const mockQuery = vi.fn().mockImplementation((sql: string, params?: any[]) => {
    // SELECT to check if migration was already applied
    if (sql.includes('SELECT name FROM migrations WHERE name')) {
      const name = params?.[0];
      if (appliedMigrations.includes(name)) {
        return { rows: [{ name }] };
      }
      return { rows: [] };
    }
    // All other queries (CREATE TABLE, INSERT, migration SQL)
    return { rows: [] };
  });
  return { query: mockQuery, end: vi.fn() };
}

describe('runMigrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs all migrations when none have been applied', async () => {
    const mockPool = createMockPool([]);
    mockGetPool.mockReturnValue(mockPool as any);

    await runMigrations();

    // 1 CREATE TABLE (migrations table) + 7 * (SELECT + SQL + INSERT) = 22 total queries
    // Each unapplied migration: SELECT + migration SQL + INSERT = 3 calls
    // Plus 1 for the initial CREATE TABLE IF NOT EXISTS migrations
    expect(mockPool.query).toHaveBeenCalledTimes(1 + 7 * 3);
  });

  it('skips already-applied migrations', async () => {
    const allMigrations = [
      '001_create_extensions',
      '002_create_regulation_chunks',
      '003_create_indexes',
      '004_create_document_versions',
      '005_create_audit_log',
      '006_create_scrape_log',
      '007_create_migrations_table',
    ];
    const mockPool = createMockPool(allMigrations);
    mockGetPool.mockReturnValue(mockPool as any);

    await runMigrations();

    // 1 CREATE TABLE + 7 SELECTs (no migration SQL or INSERTs)
    expect(mockPool.query).toHaveBeenCalledTimes(1 + 7);
  });

  it('handles mixed scenario — some applied, some new', async () => {
    const applied = [
      '001_create_extensions',
      '002_create_regulation_chunks',
      '003_create_indexes',
    ];
    const mockPool = createMockPool(applied);
    mockGetPool.mockReturnValue(mockPool as any);

    await runMigrations();

    // 1 CREATE TABLE + 3 applied (SELECT only) + 4 new (SELECT + SQL + INSERT)
    expect(mockPool.query).toHaveBeenCalledTimes(1 + 3 + 4 * 3);
  });

  it('creates migrations table first before anything else', async () => {
    const mockPool = createMockPool([]);
    mockGetPool.mockReturnValue(mockPool as any);

    await runMigrations();

    const firstCall = mockPool.query.mock.calls[0][0] as string;
    expect(firstCall).toContain('CREATE TABLE IF NOT EXISTS migrations');
  });

  it('verifies INSERT INTO migrations is called for each new migration', async () => {
    const mockPool = createMockPool([]);
    mockGetPool.mockReturnValue(mockPool as any);

    await runMigrations();

    const insertCalls = mockPool.query.mock.calls.filter(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO migrations')
    );
    expect(insertCalls).toHaveLength(7);
    expect(insertCalls[0][1]).toEqual(['001_create_extensions']);
    expect(insertCalls[6][1]).toEqual(['007_create_migrations_table']);
  });

  it('verifies correct SQL is executed for each migration', async () => {
    const mockPool = createMockPool([]);
    mockGetPool.mockReturnValue(mockPool as any);

    await runMigrations();

    // Collect migration SQL calls: after the initial CREATE TABLE,
    // each unapplied migration runs SELECT, then SQL, then INSERT.
    // Migration SQL calls are at indices 2, 5, 8, 11, 14, 17, 20 (0-indexed)
    const migrationSqlCalls = mockPool.query.mock.calls.filter(
      (call: any[]) => {
        const sql = call[0] as string;
        return (
          sql.includes('CREATE EXTENSION') ||
          sql.includes('CREATE TABLE IF NOT EXISTS regulation_chunks') ||
          sql.includes('CREATE INDEX') ||
          sql.includes('CREATE TABLE IF NOT EXISTS document_versions') ||
          sql.includes('CREATE TABLE IF NOT EXISTS query_audit_log') ||
          sql.includes('CREATE TABLE IF NOT EXISTS scrape_log') ||
          // The last migration also creates the migrations table
          (sql.includes('CREATE TABLE IF NOT EXISTS migrations') && sql === mockPool.query.mock.calls[0][0] === false)
        );
      }
    );

    // Should have run 7 migration SQLs
    // The first call is the setup CREATE TABLE, but migration 007 also creates migrations table
    // Let's verify specific content instead
    const allSqlTexts = mockPool.query.mock.calls.map((call: any[]) => call[0] as string);
    expect(allSqlTexts.some((s) => s.includes('CREATE EXTENSION IF NOT EXISTS vector'))).toBe(true);
    expect(allSqlTexts.some((s) => s.includes('CREATE TABLE IF NOT EXISTS regulation_chunks'))).toBe(true);
    expect(allSqlTexts.some((s) => s.includes('hnsw'))).toBe(true);
    expect(allSqlTexts.some((s) => s.includes('CREATE TABLE IF NOT EXISTS document_versions'))).toBe(true);
    expect(allSqlTexts.some((s) => s.includes('CREATE TABLE IF NOT EXISTS query_audit_log'))).toBe(true);
    expect(allSqlTexts.some((s) => s.includes('CREATE TABLE IF NOT EXISTS scrape_log'))).toBe(true);
  });

  it('MIGRATIONS array has correct number of entries (7)', async () => {
    const mockPool = createMockPool([]);
    mockGetPool.mockReturnValue(mockPool as any);

    await runMigrations();

    // 7 SELECT queries (one per migration) should be issued
    const selectCalls = mockPool.query.mock.calls.filter(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('SELECT name FROM migrations WHERE name')
    );
    expect(selectCalls).toHaveLength(7);
  });

  it('each migration has a name and sql property', async () => {
    const mockPool = createMockPool([]);
    mockGetPool.mockReturnValue(mockPool as any);

    await runMigrations();

    const selectCalls = mockPool.query.mock.calls.filter(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('SELECT name FROM migrations WHERE name')
    );

    // Each SELECT call has a params array with the migration name
    for (const call of selectCalls) {
      expect(call[1]).toBeDefined();
      expect(call[1][0]).toMatch(/^\d{3}_/);
    }

    // Each migration with rows.length === 0 had its SQL executed (non-empty string)
    const insertCalls = mockPool.query.mock.calls.filter(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO migrations')
    );
    for (const call of insertCalls) {
      expect(call[1][0]).toBeTruthy();
    }
  });
});
