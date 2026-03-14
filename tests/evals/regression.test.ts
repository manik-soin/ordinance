import { describe, it, expect } from 'vitest';
import goldenQA from '../fixtures/golden-qa.json';

/**
 * Regression tests using the golden Q&A set.
 * Ensures pipeline changes don't degrade answer quality.
 * Run with: npm run test:evals
 */
describe('Golden QA Regression', () => {
  it('golden QA set has at least 25 entries', () => {
    expect(goldenQA.length).toBeGreaterThanOrEqual(25);
  });

  it('each entry has required fields', () => {
    for (const qa of goldenQA) {
      expect(qa.id).toBeTruthy();
      expect(qa.question).toBeTruthy();
      expect(qa.expected_source).toBeTruthy();
      expect(qa.department).toBeTruthy();
      expect(qa.difficulty).toBeTruthy();
    }
  });

  it('covers multiple departments', () => {
    const departments = new Set(goldenQA.map((qa) => qa.department));
    expect(departments.size).toBeGreaterThanOrEqual(3);
  });

  it('covers multiple difficulty levels', () => {
    const difficulties = new Set(goldenQA.map((qa) => qa.difficulty));
    expect(difficulties.size).toBeGreaterThanOrEqual(2);
  });

  it.todo('all factual questions retrieve correct source document');
  it.todo('all questions achieve faithfulness ≥ 7/10');
  it.todo('overall citation accuracy ≥ 95%');
});
