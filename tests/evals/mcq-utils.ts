/**
 * MCQ Evaluation Utilities
 *
 * Shared between the vitest test file and the CLI eval runner.
 * No vitest imports — pure TypeScript.
 */

export interface MCQQuestion {
  id: string;
  question: string;
  options: Record<string, string>;
  correct_answer: string;
  statutory_reference: string;
  source_document: string;
  department: string;
  category: string;
  difficulty: string;
  requires_multi_statement: boolean;
  topic: string;
}

export interface MCQEvalResult {
  questionId: string;
  question: string;
  expectedAnswer: string;
  systemAnswer: string | null;
  correct: boolean;
  sourceHit: boolean;
  responseText: string;
  latencyMs: number;
  difficulty: string;
  category: string;
  requiresMultiStatement: boolean;
}

export interface MCQBenchmarkReport {
  totalQuestions: number;
  answered: number;
  correct: number;
  accuracy: number;
  sourceHitRate: number;
  byDifficulty: Record<string, { total: number; correct: number; accuracy: number }>;
  byCategory: Record<string, { total: number; correct: number; accuracy: number }>;
  multiStatementAccuracy: number;
  singleStatementAccuracy: number;
  avgLatencyMs: number;
  failures: Array<{ id: string; expected: string; got: string | null; question: string }>;
}

/**
 * Extract the MCQ answer letter from a generated response.
 * Handles diverse LLM output formats discovered during benchmark runs.
 */
export function extractMCQAnswer(response: string): string | null {
  // Pattern 1: "The answer is X" / "The correct answer is X" / "Answer: X"
  const answerIs = response.match(/(?:the\s+)?(?:correct\s+)?answer\s*(?:is|:)\s*[:\s]*\**([A-D])\b/i);
  if (answerIs) return answerIs[1].toUpperCase();

  // Pattern 2: "Option X" or "Choice X"
  const option = response.match(/(?:option|choice)\s+([A-D])\b/i);
  if (option) return option[1].toUpperCase();

  // Pattern 3: Bold letter possibly with trailing text: **A**, **A.**, **D.**, **A. Cinema complex**
  const boldLetter = response.match(/\*\*([A-D])[.):\s]/);
  if (boldLetter) return boldLetter[1].toUpperCase();

  // Pattern 3b: Bold letter alone: **A**
  const boldExact = response.match(/\*\*([A-D])\*\*/);
  if (boldExact) return boldExact[1].toUpperCase();

  // Pattern 5: Standalone letter at start of line: "A." or "A)" or "A:"
  const standalone = response.match(/^([A-D])[.):\s]/m);
  if (standalone) return standalone[1].toUpperCase();

  // Pattern 6: Parenthesized: (A), (B)
  const paren = response.match(/\(([A-D])\)/);
  if (paren) return paren[1].toUpperCase();

  // Pattern 7: First single letter A-D on its own line
  const line = response.match(/^([A-D])$/m);
  if (line) return line[1].toUpperCase();

  return null;
}

/**
 * Check if any retrieved source matches the expected statutory reference.
 */
export function checkSourceHit(
  retrievedDocNames: string[],
  expectedRef: string,
  expectedDocument: string
): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

  const normalizedExpectedDoc = normalize(expectedDocument);

  for (const doc of retrievedDocNames) {
    const normalizedDoc = normalize(doc);

    if (normalizedDoc.includes(normalizedExpectedDoc) || normalizedExpectedDoc.includes(normalizedDoc)) {
      return true;
    }

    const refTerms = expectedRef.split(/[\s/&,]+/).filter(t => t.length > 2);
    const matchedTerms = refTerms.filter(term => normalizedDoc.includes(normalize(term)));
    if (matchedTerms.length >= 2) return true;
  }

  return false;
}

/**
 * Compute aggregate benchmark report from individual results.
 */
export function computeBenchmarkReport(results: MCQEvalResult[]): MCQBenchmarkReport {
  const answered = results.filter(r => r.systemAnswer !== null);
  const correct = results.filter(r => r.correct);
  const sourceHits = results.filter(r => r.sourceHit);
  const multi = results.filter(r => r.requiresMultiStatement);
  const single = results.filter(r => !r.requiresMultiStatement);

  const byDifficulty: Record<string, { total: number; correct: number; accuracy: number }> = {};
  const byCategory: Record<string, { total: number; correct: number; accuracy: number }> = {};

  for (const r of results) {
    if (!byDifficulty[r.difficulty]) byDifficulty[r.difficulty] = { total: 0, correct: 0, accuracy: 0 };
    byDifficulty[r.difficulty].total++;
    if (r.correct) byDifficulty[r.difficulty].correct++;

    if (!byCategory[r.category]) byCategory[r.category] = { total: 0, correct: 0, accuracy: 0 };
    byCategory[r.category].total++;
    if (r.correct) byCategory[r.category].correct++;
  }

  for (const d of Object.values(byDifficulty)) d.accuracy = d.total > 0 ? d.correct / d.total : 0;
  for (const c of Object.values(byCategory)) c.accuracy = c.total > 0 ? c.correct / c.total : 0;

  const multiCorrect = multi.filter(r => r.correct).length;
  const singleCorrect = single.filter(r => r.correct).length;

  return {
    totalQuestions: results.length,
    answered: answered.length,
    correct: correct.length,
    accuracy: results.length > 0 ? correct.length / results.length : 0,
    sourceHitRate: results.length > 0 ? sourceHits.length / results.length : 0,
    byDifficulty,
    byCategory,
    multiStatementAccuracy: multi.length > 0 ? multiCorrect / multi.length : 0,
    singleStatementAccuracy: single.length > 0 ? singleCorrect / single.length : 0,
    avgLatencyMs: results.length > 0
      ? results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length
      : 0,
    failures: results
      .filter(r => !r.correct)
      .map(r => ({ id: r.questionId, expected: r.expectedAnswer, got: r.systemAnswer, question: r.question })),
  };
}

/**
 * Format an MCQ question for the RAG pipeline.
 * Uses a structured prompt that forces clear answer extraction.
 */
export function formatMCQForPipeline(q: MCQQuestion): string {
  const optionText = Object.entries(q.options)
    .map(([letter, text]) => `${letter}. ${text}`)
    .join('\n');

  return `${q.question}

${optionText}

Based on Hong Kong building regulations, which option (A, B, C, or D) is correct? Evaluate each option against the relevant regulations, then state your final answer in this exact format: "The answer is X" where X is the letter.`;
}
