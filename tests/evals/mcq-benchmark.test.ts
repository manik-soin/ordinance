import { describe, it, expect } from 'vitest';
import mcqDataset from '../fixtures/colleague-mcq-dataset.json';
import {
  extractMCQAnswer,
  checkSourceHit,
  computeBenchmarkReport,
  formatMCQForPipeline,
  type MCQQuestion,
  type MCQEvalResult,
} from './mcq-utils.js';

/**
 * MCQ BENCHMARK EVALUATION SUITE
 *
 * Evaluates the RAG system against a colleague-provided dataset of
 * 27 multiple-choice questions from HK Building Ordinance exams.
 */

const dataset = mcqDataset as MCQQuestion[];

// ─── Dataset Integrity Tests (always run) ───────────────────────────────────

describe('MCQ Benchmark Dataset Integrity', () => {
  it('has 27 questions', () => {
    expect(dataset.length).toBe(27);
  });

  it('each question has all required fields', () => {
    for (const q of dataset) {
      expect(q.id).toMatch(/^mcq-\d{3}$/);
      expect(q.question.length).toBeGreaterThan(10);
      expect(Object.keys(q.options)).toHaveLength(4);
      expect(['A', 'B', 'C', 'D']).toContain(q.correct_answer);
      expect(q.statutory_reference.length).toBeGreaterThan(0);
      expect(q.source_document.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate IDs', () => {
    const ids = dataset.map(q => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers at least 6 categories', () => {
    const categories = new Set(dataset.map(q => q.category));
    expect(categories.size).toBeGreaterThanOrEqual(6);
  });

  it('has both single and multi-statement questions', () => {
    const multi = dataset.filter(q => q.requires_multi_statement);
    const single = dataset.filter(q => !q.requires_multi_statement);
    expect(multi.length).toBeGreaterThanOrEqual(8);
    expect(single.length).toBeGreaterThanOrEqual(10);
  });
});

// ─── Dataset Analysis (always run) ──────────────────────────────────────────

describe('MCQ Dataset Analysis', () => {
  it('documents difficulty distribution', () => {
    const byDifficulty = new Map<string, number>();
    for (const q of dataset) {
      byDifficulty.set(q.difficulty, (byDifficulty.get(q.difficulty) ?? 0) + 1);
    }
    const dist = Object.fromEntries(byDifficulty);
    expect(dist).toBeDefined();
  });

  it('documents category distribution', () => {
    const byCategory = new Map<string, number>();
    for (const q of dataset) {
      byCategory.set(q.category, (byCategory.get(q.category) ?? 0) + 1);
    }
    const dist = Object.fromEntries(byCategory);
    expect(dist).toBeDefined();
  });

  it('documents source document coverage', () => {
    const sources = new Set(dataset.map(q => q.source_document));
    expect(sources.size).toBeGreaterThanOrEqual(8);
  });

  it('identifies multi-document questions', () => {
    const multiDoc = dataset.filter(q =>
      q.statutory_reference.includes('/') || q.statutory_reference.includes('&')
    );
    expect(multiDoc.length).toBeGreaterThanOrEqual(5);
  });
});

// ─── MCQ Answer Extraction ──────────────────────────────────────────────────

describe('MCQ Answer Extraction', () => {
  it('extracts "The answer is B"', () => {
    expect(extractMCQAnswer('Based on the regulations, the answer is B.')).toBe('B');
  });

  it('extracts "The correct answer is C"', () => {
    expect(extractMCQAnswer('The correct answer is C, because...')).toBe('C');
  });

  it('extracts "Answer: D"', () => {
    expect(extractMCQAnswer('**Answer: D.**  From the retrieved...')).toBe('D');
  });

  it('extracts "Option D"', () => {
    expect(extractMCQAnswer('I would select Option D based on...')).toBe('D');
  });

  it('extracts standalone "A."', () => {
    expect(extractMCQAnswer('A. This is correct because...')).toBe('A');
  });

  it('extracts bold **B**', () => {
    expect(extractMCQAnswer('The answer is **B** per the FS Code.')).toBe('B');
  });

  it('extracts bold with period **C.**', () => {
    expect(extractMCQAnswer('**C.** The retrieved materials indicate...')).toBe('C');
  });

  it('extracts bold with period **D.**', () => {
    expect(extractMCQAnswer('**D.** A development proposal for...')).toBe('D');
  });

  it('extracts bold letter followed by text **A. Cinema**', () => {
    expect(extractMCQAnswer('**A. Cinema complex**\n\nFrom the retrieved...')).toBe('A');
  });

  it('extracts parenthesized (C)', () => {
    expect(extractMCQAnswer('(C) is the correct option.')).toBe('C');
  });

  it('returns null for ambiguous response', () => {
    expect(extractMCQAnswer('The fire resistance period is 2 hours.')).toBeNull();
  });

  it('returns null for "insufficient information" response', () => {
    expect(extractMCQAnswer('I do not have sufficient information to determine the answer.')).toBeNull();
  });
});

// ─── Benchmark Report Computation ───────────────────────────────────────────

describe('Benchmark Report Computation', () => {
  it('computes correct accuracy from results', () => {
    const results: MCQEvalResult[] = [
      { questionId: 'mcq-001', question: 'Q1', expectedAnswer: 'A', systemAnswer: 'A', correct: true, sourceHit: true, responseText: '', latencyMs: 100, difficulty: 'factual', category: 'planning', requiresMultiStatement: false },
      { questionId: 'mcq-002', question: 'Q2', expectedAnswer: 'C', systemAnswer: 'B', correct: false, sourceHit: true, responseText: '', latencyMs: 200, difficulty: 'factual', category: 'legislation', requiresMultiStatement: false },
      { questionId: 'mcq-007', question: 'Q7', expectedAnswer: 'C', systemAnswer: 'C', correct: true, sourceHit: false, responseText: '', latencyMs: 300, difficulty: 'multi_statement', category: 'fire_safety', requiresMultiStatement: true },
    ];

    const report = computeBenchmarkReport(results);
    expect(report.accuracy).toBeCloseTo(2 / 3, 2);
    expect(report.sourceHitRate).toBeCloseTo(2 / 3, 2);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0].id).toBe('mcq-002');
  });

  it('handles empty results', () => {
    const report = computeBenchmarkReport([]);
    expect(report.accuracy).toBe(0);
    expect(report.totalQuestions).toBe(0);
  });
});

// ─── Source Document Matching ───────────────────────────────────────────────

describe('Source Document Matching', () => {
  it('matches exact document name', () => {
    expect(checkSourceHit(
      ['Building (Planning) Regulations Cap. 123F'],
      'B(P)R 15A',
      'Building (Planning) Regulations'
    )).toBe(true);
  });

  it('matches partial document name', () => {
    expect(checkSourceHit(
      ['Code of Practice for Fire Safety in Buildings 2011'],
      'FS Code',
      'Code of Practice for Fire Safety in Buildings'
    )).toBe(true);
  });

  it('returns false for unrelated documents', () => {
    expect(checkSourceHit(
      ['Code of Practice for Demolition of Buildings 2004'],
      'FS Code',
      'Code of Practice for Fire Safety in Buildings'
    )).toBe(false);
  });
});

// ─── Live Pipeline Evaluation (requires DB + API keys) ──────────────────────

describe.skipIf(!process.env.DATABASE_URL || !process.env.OPENAI_API_KEY)(
  'MCQ Benchmark — Live Pipeline Evaluation',
  () => {
    it.todo('achieves >= 60% accuracy on full dataset');
    it.todo('achieves >= 75% accuracy on factual questions');
    it.todo('achieves >= 50% accuracy on multi-statement questions');
    it.todo('achieves >= 80% source retrieval hit rate');
    it.todo('fire_safety category achieves >= 65% accuracy');
    it.todo('primary_legislation category achieves >= 70% accuracy');
    it.todo('average latency is under 15 seconds per question');
  }
);

// ─── MCQ Prompt Formatting ──────────────────────────────────────────────────

describe('MCQ Prompt Formatting', () => {
  it('includes question and all options', () => {
    const formatted = formatMCQForPipeline(dataset[0]);
    expect(formatted).toContain(dataset[0].question);
    expect(formatted).toContain('A.');
    expect(formatted).toContain('B.');
    expect(formatted).toContain('C.');
    expect(formatted).toContain('D.');
  });

  it('asks for a clear answer letter', () => {
    const formatted = formatMCQForPipeline(dataset[0]);
    expect(formatted).toContain('The answer is X');
  });
});
