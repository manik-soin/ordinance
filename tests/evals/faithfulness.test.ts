import { describe, it, expect } from 'vitest';

/**
 * Faithfulness evaluation tests.
 * These require API keys and a populated database.
 * Run with: npm run test:evals
 */
describe('Faithfulness Evaluation', () => {
  it.todo('scores ≥ 7/10 for factual questions from golden set');
  it.todo('scores ≥ 8/10 for single-section factual questions');
  it.todo('scores ≤ 3/10 for fabricated answers (negative control)');
  it.todo('detects when answer contradicts source material');
  it.todo('flags hallucinated regulation numbers');
});
