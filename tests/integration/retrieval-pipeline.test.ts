import { describe, it, expect } from 'vitest';

/**
 * Integration tests for the full retrieval pipeline.
 * Requires: DATABASE_URL, OPENAI_API_KEY (populated DB)
 * Run with: npm run test:integration
 */
describe('Retrieval Pipeline', () => {
  it.todo('returns relevant chunks for fire safety query');
  it.todo('hybrid search combines vector and keyword results');
  it.todo('department filter scopes results correctly');
  it.todo('generates cited answer from retrieved context');
  it.todo('citation verification catches phantom citations');
  it.todo('audit log is created for each query');
});
