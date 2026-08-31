import pg from 'pg';

const { Pool } = pg;

let _pool: pg.Pool | null = null;

export function getPool(connectionString?: string): pg.Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: connectionString ?? process.env.DATABASE_URL,
      max: 10,
      // No manual ssl override: sslmode in the connection string governs TLS
      // (production uses sslmode=verify-full against Neon).
    });
    // An idle client dropping its connection (Neon pooler timeout, network
    // blip) emits 'error' on the pool; without a handler that event crashes
    // the whole process. Log and let the pool replace the client.
    _pool.on('error', (err) => {
      console.error('[DB] Idle client error (non-fatal):', err.message);
    });
  }
  return _pool;
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
