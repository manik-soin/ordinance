import { describe, it, expect } from 'vitest';

/**
 * Integration tests for the full ingestion pipeline.
 * Requires: DATABASE_URL, OPENAI_API_KEY
 * Run with: npm run test:integration
 */
describe('Ingestion Pipeline', () => {
  it.todo('fetches a real BD code PDF and extracts text');
  it.todo('chunks extracted text with correct metadata');
  it.todo('generates embeddings for all chunks');
  it.todo('stores chunks in pgvector with correct schema');
  it.todo('detects document changes via content hash');
  it.todo('supersedes old chunks when document is re-ingested');
});
