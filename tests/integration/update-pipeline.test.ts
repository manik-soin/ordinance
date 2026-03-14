import { describe, it, expect } from 'vitest';

/**
 * Integration tests for the update/change detection pipeline.
 * Requires: DATABASE_URL
 * Run with: npm run test:integration
 */
describe('Update Pipeline', () => {
  it.todo('detects when document content hash changes');
  it.todo('re-ingests changed document');
  it.todo('supersedes old chunks after re-ingestion');
  it.todo('preserves old version in document_versions table');
  it.todo('logs scrape run results');
});
