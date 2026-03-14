import { describe, it, expect } from 'vitest';
import goldenQA from '../fixtures/golden-qa.json';

/**
 * Regression tests using the golden Q&A set.
 * Ensures pipeline changes don't degrade answer quality.
 * Run with: npm run test:evals
 */

interface GoldenQA {
  id: string;
  question: string;
  expected_source: string;
  expected_section: string;
  expected_answer_contains: string[];
  department: string;
  difficulty: string;
  category: string;
}

const typedQA = goldenQA as GoldenQA[];

describe('Golden QA Regression', () => {
  it('golden QA set has at least 50 entries', () => {
    expect(typedQA.length).toBeGreaterThanOrEqual(50);
  });

  it('each entry has all required fields', () => {
    const requiredFields: (keyof GoldenQA)[] = [
      'id',
      'question',
      'expected_source',
      'expected_section',
      'expected_answer_contains',
      'department',
      'difficulty',
      'category',
    ];

    for (const qa of typedQA) {
      for (const field of requiredFields) {
        expect(qa[field], `Entry ${qa.id} is missing field "${field}"`).toBeTruthy();
      }
    }
  });

  it('has no duplicate IDs', () => {
    const ids = typedQA.map((qa) => qa.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);

    // Report which IDs are duplicated if any
    const seen = new Set<string>();
    for (const id of ids) {
      expect(seen.has(id), `Duplicate ID found: ${id}`).toBe(false);
      seen.add(id);
    }
  });

  it('has all unique questions', () => {
    const questions = typedQA.map((qa) => qa.question);
    const uniqueQuestions = new Set(questions);
    expect(
      uniqueQuestions.size,
      `Found ${questions.length - uniqueQuestions.size} duplicate question(s)`
    ).toBe(questions.length);
  });

  it('each entry has at least 1 keyword in expected_answer_contains', () => {
    for (const qa of typedQA) {
      expect(
        Array.isArray(qa.expected_answer_contains),
        `Entry ${qa.id}: expected_answer_contains must be an array`
      ).toBe(true);
      expect(
        qa.expected_answer_contains.length,
        `Entry ${qa.id}: expected_answer_contains must have at least 1 keyword`
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('covers at least 5 departments', () => {
    const departments = new Set(typedQA.map((qa) => qa.department));
    expect(
      departments.size,
      `Only ${departments.size} departments found: ${[...departments].join(', ')}`
    ).toBeGreaterThanOrEqual(5);
  });

  it('covers at least 4 difficulty levels', () => {
    const difficulties = new Set(typedQA.map((qa) => qa.difficulty));
    expect(
      difficulties.size,
      `Only ${difficulties.size} difficulty levels found: ${[...difficulties].join(', ')}`
    ).toBeGreaterThanOrEqual(4);
  });

  it('covers at least 8 categories', () => {
    const categories = new Set(typedQA.map((qa) => qa.category));
    expect(
      categories.size,
      `Only ${categories.size} categories found: ${[...categories].join(', ')}`
    ).toBeGreaterThanOrEqual(8);
  });

  it('IDs follow sequential qa-NNN pattern', () => {
    for (const qa of typedQA) {
      expect(qa.id).toMatch(/^qa-\d{3}$/);
    }
  });

  it('includes cross-regulatory difficulty entries', () => {
    const crossReg = typedQA.filter((qa) => qa.difficulty === 'cross-regulatory');
    expect(crossReg.length).toBeGreaterThanOrEqual(1);
  });

  it('includes scenario difficulty entries', () => {
    const scenarios = typedQA.filter((qa) => qa.difficulty === 'scenario');
    expect(scenarios.length).toBeGreaterThanOrEqual(1);
  });

  it.todo('all factual questions retrieve correct source document');
  it.todo('all questions achieve faithfulness >= 7/10');
  it.todo('overall citation accuracy >= 95%');
});
