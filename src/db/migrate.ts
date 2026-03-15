import { getPool, closePool } from './pool.js';
import dotenv from 'dotenv';

dotenv.config();

const MIGRATIONS = [
  {
    name: '001_create_extensions',
    sql: `
      CREATE EXTENSION IF NOT EXISTS vector;
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    `,
  },
  {
    name: '002_create_regulation_chunks',
    sql: `
      CREATE TABLE IF NOT EXISTS regulation_chunks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        content TEXT NOT NULL,
        embedding VECTOR(3072),

        -- Source metadata
        source_department TEXT NOT NULL,
        document_type TEXT NOT NULL,
        document_name TEXT NOT NULL,
        version TEXT,
        effective_date DATE,
        cap_number TEXT,
        pnap_number TEXT,

        -- Hierarchy
        section_hierarchy TEXT[],
        page_number INTEGER,

        -- Versioning
        is_current BOOLEAN DEFAULT true,
        superseded_by UUID REFERENCES regulation_chunks(id),
        content_hash TEXT NOT NULL,

        -- Cross-references
        cross_references TEXT[],

        -- Full-text search
        search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,

        -- Timestamps
        ingested_at TIMESTAMPTZ DEFAULT NOW(),
        source_fetched_at TIMESTAMPTZ
      );
    `,
  },
  {
    name: '003_create_indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_chunks_search ON regulation_chunks USING gin (search_vector);
      CREATE INDEX IF NOT EXISTS idx_chunks_dept_type ON regulation_chunks (source_department, document_type);
      CREATE INDEX IF NOT EXISTS idx_chunks_current ON regulation_chunks (is_current);
      CREATE INDEX IF NOT EXISTS idx_chunks_cap ON regulation_chunks (cap_number);
    `,
  },
  {
    name: '004_create_document_versions',
    sql: `
      CREATE TABLE IF NOT EXISTS document_versions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        document_name TEXT NOT NULL,
        source_department TEXT NOT NULL,
        version TEXT,
        content_hash TEXT NOT NULL,
        fetched_at TIMESTAMPTZ DEFAULT NOW(),
        status TEXT DEFAULT 'current',
        pdf_url TEXT,
        chunk_count INTEGER
      );
    `,
  },
  {
    name: '005_create_audit_log',
    sql: `
      CREATE TABLE IF NOT EXISTS query_audit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        query TEXT NOT NULL,
        filters JSONB,
        retrieved_chunk_ids UUID[],
        response TEXT,
        citations JSONB,
        faithfulness_score REAL,
        citation_accuracy REAL,
        model_used TEXT,
        latency_ms INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `,
  },
  {
    name: '006_create_scrape_log',
    sql: `
      CREATE TABLE IF NOT EXISTS scrape_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source_department TEXT NOT NULL,
        documents_checked INTEGER DEFAULT 0,
        documents_changed INTEGER DEFAULT 0,
        documents_failed INTEGER DEFAULT 0,
        errors JSONB,
        started_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );
    `,
  },
  {
    name: '007_create_migrations_table',
    sql: `
      CREATE TABLE IF NOT EXISTS migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      );
    `,
  },
  {
    name: '008_fix_vector_index',
    sql: `
      DROP INDEX IF EXISTS idx_chunks_embedding;
    `,
  },
  {
    name: '009_enable_pgcrypto_and_chunk_vector_index',
    sql: `
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
    `,
  },
  {
    name: '010_ivfflat_vector_index',
    sql: `
      SELECT 1;
    `,
  },
];

export async function runMigrations(): Promise<void> {
  const pool = getPool();

  // Ensure migrations table exists first
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  for (const migration of MIGRATIONS) {
    const { rows } = await pool.query(
      'SELECT name FROM migrations WHERE name = $1',
      [migration.name]
    );

    if (rows.length === 0) {
      console.log(`Running migration: ${migration.name}`);
      await pool.query(migration.sql);
      await pool.query(
        'INSERT INTO migrations (name) VALUES ($1)',
        [migration.name]
      );
      console.log(`  ✓ ${migration.name}`);
    } else {
      console.log(`  ⏭ ${migration.name} (already applied)`);
    }
  }

  console.log('All migrations complete.');
}

// Run if called directly
const isDirectRun = process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js');
if (isDirectRun) {
  runMigrations()
    .then(() => closePool())
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
