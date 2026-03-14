import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let poolConstructorArgs: any[] = [];

vi.mock('pg', () => {
  class MockPool {
    end = vi.fn().mockResolvedValue(undefined);
    query = vi.fn();
    constructor(opts: any) {
      poolConstructorArgs.push(opts);
    }
  }
  return { default: { Pool: MockPool }, Pool: MockPool };
});

describe('pool', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    vi.resetModules();
    poolConstructorArgs = [];
    process.env = { ...originalEnv };
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb';
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('getPool returns a Pool instance', async () => {
    const { getPool } = await import('../../src/db/pool.js');
    const pool = getPool();
    expect(pool).toBeDefined();
    expect(pool).toHaveProperty('query');
    expect(pool).toHaveProperty('end');
  });

  it('getPool returns the same instance on subsequent calls (singleton)', async () => {
    const { getPool } = await import('../../src/db/pool.js');
    const pool1 = getPool();
    const pool2 = getPool();
    expect(pool1).toBe(pool2);
  });

  it('getPool uses DATABASE_URL from env', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@host:5432/mydb';
    const { getPool } = await import('../../src/db/pool.js');

    getPool();

    expect(poolConstructorArgs).toHaveLength(1);
    expect(poolConstructorArgs[0]).toMatchObject({
      connectionString: 'postgresql://user:pass@host:5432/mydb',
    });
  });

  it('getPool uses custom connectionString when provided', async () => {
    const { getPool } = await import('../../src/db/pool.js');

    getPool('postgresql://custom:custom@customhost:5432/customdb');

    expect(poolConstructorArgs).toHaveLength(1);
    expect(poolConstructorArgs[0]).toMatchObject({
      connectionString: 'postgresql://custom:custom@customhost:5432/customdb',
    });
  });

  it('getPool sets ssl for production NODE_ENV', async () => {
    process.env.NODE_ENV = 'production';
    const { getPool } = await import('../../src/db/pool.js');

    getPool();

    expect(poolConstructorArgs).toHaveLength(1);
    expect(poolConstructorArgs[0].ssl).toEqual({ rejectUnauthorized: false });
  });

  it('getPool does not set ssl for development', async () => {
    process.env.NODE_ENV = 'development';
    const { getPool } = await import('../../src/db/pool.js');

    getPool();

    expect(poolConstructorArgs).toHaveLength(1);
    expect(poolConstructorArgs[0].ssl).toBeUndefined();
  });

  it('closePool calls pool.end()', async () => {
    const { getPool, closePool } = await import('../../src/db/pool.js');
    const pool = getPool();

    await closePool();

    expect(pool.end).toHaveBeenCalledOnce();
  });

  it('closePool is idempotent (calling twice does not throw)', async () => {
    const { getPool, closePool } = await import('../../src/db/pool.js');
    getPool();

    await closePool();
    await expect(closePool()).resolves.toBeUndefined();
  });

  it('after closePool, getPool creates a new pool', async () => {
    const { getPool, closePool } = await import('../../src/db/pool.js');
    const pool1 = getPool();

    await closePool();

    const pool2 = getPool();
    expect(pool2).not.toBe(pool1);
  });
});
