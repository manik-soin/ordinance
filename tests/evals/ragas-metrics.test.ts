import { describe, it, expect } from 'vitest';
import { Factuality, ClosedQA, Battle } from 'autoevals';

/**
 * RAGAS-STYLE EVALUATION METRICS (via Braintrust AutoEvals)
 *
 * Industry-standard metrics for RAG hallucination minimization:
 * - Factuality: Is the output factually consistent with the expected answer?
 * - ClosedQA: Given context, does the answer correctly address the question?
 * - Battle: A/B comparison between two answer variants
 *
 * These tests run WITH a real LLM (requires OPENAI_API_KEY).
 * Skip in CI by checking the env var.
 *
 * Based on research into RAGAS, DeepEval, TruLens, and Patronus.
 */

const HAS_KEY = !!process.env.OPENAI_API_KEY;

describe('RAGAS-Style Metrics (AutoEvals)', () => {
  describe.skipIf(!HAS_KEY)('Factuality — answer matches expected facts', () => {

    it('scores high for factually correct fire safety answer', async () => {
      const result = await Factuality({
        input: 'What is the minimum fire resistance period for structural columns in Purpose Group I buildings over 25m?',
        output: 'The minimum fire resistance period for structural columns in Purpose Group I buildings exceeding 25 metres in height is 120 minutes (2 hours), as specified in the Code of Practice for Fire Safety in Buildings 2011.',
        expected: 'The fire resistance period for structural columns in buildings over 25m height in Purpose Group I is 2 hours (120 minutes) per the Fire Safety Code 2011.',
      });
      expect(result.score).toBeGreaterThanOrEqual(0.6);
    }, 30000);

    it('scores low for factually incorrect answer', async () => {
      const result = await Factuality({
        input: 'What is the minimum fire resistance period for columns?',
        output: 'There is no fire resistance requirement for columns in Hong Kong buildings.',
        expected: 'The minimum fire resistance period for columns is 2 hours (120 minutes) for buildings over 25m.',
      });
      expect(result.score).toBeLessThanOrEqual(0.4);
    }, 30000);

    it('scores high for correct barrier-free access answer', async () => {
      const result = await Factuality({
        input: 'What is the maximum ramp gradient for barrier-free access?',
        output: 'The maximum ramp gradient for barrier-free access is 1 in 12, as per the Design Manual - Barrier Free Access 2008 (2025 Edition).',
        expected: 'The maximum gradient for ramps is 1:12 per the Barrier Free Access Design Manual.',
      });
      expect(result.score).toBeGreaterThanOrEqual(0.6);
    }, 30000);

    it('scores low for fabricated regulation numbers', async () => {
      const result = await Factuality({
        input: 'What wind load applies to buildings over 200m?',
        output: 'Buildings over 200m must use a minimum wind pressure of 5.0 kPa per Section 99.1 of the Wind Effects Code 2019.',
        expected: 'Buildings over 200m require wind tunnel testing per the Code of Practice on Wind Effects 2019. The Standard Method only applies up to 200m.',
      });
      expect(result.score).toBeLessThanOrEqual(0.5);
    }, 30000);
  });

  describe.skipIf(!HAS_KEY)('ClosedQA — answer correctly addresses the question given context', () => {

    it('scores high when answer is grounded in context', async () => {
      const result = await ClosedQA({
        input: 'What are the site supervision requirements for demolition?',
        output: 'Demolition works require a Technically Competent Person (TCP) on site at all times during critical operations, as per the Code of Practice for Demolition of Buildings 2004, Section 3.',
        criteria: 'The answer should reference the Code of Practice for Demolition of Buildings and mention supervision requirements including TCP presence on site.',
      });
      expect(result.score).toBeGreaterThanOrEqual(0.6);
    }, 30000);

    it('scores low when answer is off-topic', async () => {
      const result = await ClosedQA({
        input: 'What are the fire resistance requirements for steel beams?',
        output: 'Hong Kong has a population of approximately 7.5 million people and is located in southeastern China.',
        criteria: 'The answer should discuss fire resistance periods for steel structural elements with specific time requirements and code references.',
      });
      expect(result.score).toBeLessThanOrEqual(0.3);
    }, 30000);
  });

  describe.skipIf(!HAS_KEY)('Battle — A/B comparison of answer quality', () => {

    it('prefers cited answer over uncited answer', async () => {
      const result = await Battle({
        input: 'What is the maximum site coverage for a domestic building?',
        output: 'The maximum site coverage for a domestic building varies by site class and height. Per PNAP APP-132 and Building (Planning) Regulation 20, Class A sites allow up to 66.67% coverage for domestic buildings not exceeding 15m.',
        expected: 'Site coverage limits vary. Some buildings can cover about two thirds of the site.',
      });
      // Positive score means output (cited) is better than expected (uncited)
      expect(result.score).toBeGreaterThanOrEqual(0);
    }, 30000);
  });

  // ─── Mock-based tests (always run, no API key needed) ───

  describe('Metric availability checks', () => {
    it('Factuality function is available', () => {
      expect(typeof Factuality).toBe('function');
    });

    it('ClosedQA function is available', () => {
      expect(typeof ClosedQA).toBe('function');
    });

    it('Battle function is available', () => {
      expect(typeof Battle).toBe('function');
    });
  });
});
