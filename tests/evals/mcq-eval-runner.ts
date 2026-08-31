/**
 * MCQ Evaluation Runner
 *
 * Runs the colleague's 27-question MCQ dataset against the live RAG pipeline
 * and produces a comprehensive benchmark report.
 *
 * Usage:
 *   npx tsx tests/evals/mcq-eval-runner.ts [--dry-run] [--first N] [--question mcq-001]
 *   npx tsx tests/evals/mcq-eval-runner.ts --no-rag          # Pure LLM baseline (no retrieval)
 *   npx tsx tests/evals/mcq-eval-runner.ts --model gpt-5-mini # Use a different model
 *   npx tsx tests/evals/mcq-eval-runner.ts --no-rag --provider gemini --model gemini-2.5-pro
 *
 * Requires: DATABASE_URL, OPENAI_API_KEY environment variables
 * For Gemini: GEMINI_API_KEY environment variable
 *
 * Output: JSON report to tests/evals/mcq-results-{timestamp}.json
 */

import dotenv from 'dotenv';
dotenv.config();

import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { getPool } from '../../src/db/pool.js';
import { queryPipeline } from '../../src/pipeline/query.js';
import {
  extractMCQAnswer,
  checkSourceHit,
  computeBenchmarkReport,
  formatMCQForPipeline,
  type MCQQuestion,
  type MCQEvalResult,
} from './mcq-utils.js';
import mcqDataset from '../fixtures/colleague-mcq-dataset.json' with { type: 'json' };
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataset = mcqDataset as MCQQuestion[];

/**
 * Debiased MCQ prompt: explicitly instructs the model to avoid position bias,
 * evaluate all options equally, and use elimination reasoning.
 */
function formatDebiasedMCQ(q: MCQQuestion): string {
  const optionText = Object.entries(q.options)
    .map(([letter, text]) => `${letter}. ${text}`)
    .join('\n');

  return `${q.question}

${optionText}

IMPORTANT: Do NOT default to the first plausible-sounding option. Evaluate ALL four options (A, B, C, D) systematically — consider each one against the regulations before selecting. The correct answer is equally likely to be A, B, C, or D.

For each option, briefly state whether it is correct or incorrect and why. Then state your final answer in this exact format: "The answer is X" where X is the letter.`;
}

const MCQ_SYSTEM_PROMPT = `You are an expert on Hong Kong building regulations, ordinances, and codes of practice. Answer the multiple-choice question below using your knowledge of HK building law. Be precise and cite specific ordinance sections, regulations, or codes of practice where possible.`;

/**
 * No-RAG baseline via OpenAI: send MCQ directly to LLM without any retrieval context.
 */
async function runNoRagOpenAI(
  client: OpenAI,
  q: MCQQuestion,
  model: string,
): Promise<{ answer: string; latencyMs: number }> {
  const prompt = formatDebiasedMCQ(q);
  const start = Date.now();

  // gpt-5-mini doesn't support custom temperature
  const supportsTemperature = !model.includes('5-mini');
  const response = await client.chat.completions.create({
    model,
    ...(supportsTemperature ? { temperature: 0.1 } : {}),
    max_completion_tokens: 800,
    messages: [
      { role: 'system', content: MCQ_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
  });

  return {
    answer: response.choices[0]?.message?.content ?? '',
    latencyMs: Date.now() - start,
  };
}

/**
 * No-RAG baseline via Gemini: send MCQ directly to Google's Gemini model.
 */
async function runNoRagGemini(
  client: GoogleGenAI,
  q: MCQQuestion,
  model: string,
): Promise<{ answer: string; latencyMs: number }> {
  const prompt = formatDebiasedMCQ(q);
  const start = Date.now();

  const response = await client.models.generateContent({
    model,
    config: {
      temperature: 0.1,
      maxOutputTokens: 800,
      systemInstruction: MCQ_SYSTEM_PROMPT,
    },
    contents: prompt,
  });

  return {
    answer: response.text ?? '',
    latencyMs: Date.now() - start,
  };
}

async function runEvaluation(options: {
  dryRun?: boolean;
  firstN?: number;
  questionId?: string;
  noRag?: boolean;
  model?: string;
  provider?: 'openai' | 'gemini';
}) {
  const mode = options.noRag ? 'NO-RAG BASELINE' : 'RAG PIPELINE';
  const provider = options.provider ?? 'openai';
  const model = options.model ?? (provider === 'gemini' ? 'gemini-2.5-pro' : 'gpt-5.4');
  console.log(`=== MCQ Benchmark Evaluation [${mode}] [${provider}/${model}] ===\n`);

  let questions = dataset;
  if (options.questionId) {
    questions = dataset.filter(q => q.id === options.questionId);
    if (questions.length === 0) {
      console.error(`Question ${options.questionId} not found`);
      process.exit(1);
    }
  } else if (options.firstN) {
    questions = dataset.slice(0, options.firstN);
  }

  console.log(`Running ${questions.length} questions${options.dryRun ? ' (DRY RUN)' : ''}...\n`);

  if (options.dryRun) {
    for (const q of questions) {
      console.log(`--- ${q.id} (${q.difficulty}) ---`);
      console.log(`Expected: ${q.correct_answer} | Source: ${q.statutory_reference}`);
      const prompt = options.noRag ? formatDebiasedMCQ(q) : formatMCQForPipeline(q);
      console.log(`Prompt:\n${prompt.slice(0, 300)}...\n`);
    }
    return;
  }

  // For no-RAG mode, we only need an LLM client (no DB)
  const openaiClient = (!options.noRag || provider === 'openai') ? new OpenAI() : null;
  const geminiClient = (options.noRag && provider === 'gemini')
    ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })
    : null;
  const pool = options.noRag ? null : getPool();
  const results: MCQEvalResult[] = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    console.log(`[${i + 1}/${questions.length}] ${q.id}: ${q.question.slice(0, 80)}...`);

    const start = Date.now();

    try {
      let responseText: string;
      let latencyMs: number;

      if (options.noRag) {
        // No-RAG: send directly to LLM
        const result = provider === 'gemini'
          ? await runNoRagGemini(geminiClient!, q, model)
          : await runNoRagOpenAI(openaiClient!, q, model);
        responseText = result.answer;
        latencyMs = result.latencyMs;
      } else {
        // RAG pipeline — use original MCQ format (debiased prompt hurts RAG accuracy)
        const prompt = formatMCQForPipeline(q);
        const result = await queryPipeline(pool!, prompt, {
          useQueryExpansion: true,
          useReranker: true,
          useCRAG: false, // CRAG hurts MCQ accuracy; off by default
          topK: 7,
          skipFaithfulness: true,
        });
        responseText = result.answer;
        latencyMs = Date.now() - start;
      }

      const systemAnswer = extractMCQAnswer(responseText);
      const sourceHit = false; // No source matching in no-RAG mode
      const correct = systemAnswer === q.correct_answer;

      const evalResult: MCQEvalResult = {
        questionId: q.id,
        question: q.question,
        expectedAnswer: q.correct_answer,
        systemAnswer,
        correct,
        sourceHit,
        responseText,
        latencyMs,
        difficulty: q.difficulty,
        category: q.category,
        requiresMultiStatement: q.requires_multi_statement,
      };

      results.push(evalResult);

      const marker = correct ? '\u2705' : '\u274c';
      console.log(`  ${marker} Expected: ${q.correct_answer} | Got: ${systemAnswer ?? 'NULL'} | ${latencyMs}ms`);
      if (!correct) {
        console.log(`  Answer excerpt: ${responseText.slice(0, 150)}...`);
      }
      console.log();

    } catch (err) {
      const latencyMs = Date.now() - start;
      console.error(`  ERROR: ${err instanceof Error ? err.message : err}\n`);
      results.push({
        questionId: q.id,
        question: q.question,
        expectedAnswer: q.correct_answer,
        systemAnswer: null,
        correct: false,
        sourceHit: false,
        responseText: `ERROR: ${err}`,
        latencyMs,
        difficulty: q.difficulty,
        category: q.category,
        requiresMultiStatement: q.requires_multi_statement,
      });
    }
  }

  // Compute and display report
  const report = computeBenchmarkReport(results);

  console.log('\n' + '='.repeat(60));
  console.log('  BENCHMARK REPORT');
  console.log('='.repeat(60) + '\n');
  console.log(`Total Questions:  ${report.totalQuestions}`);
  console.log(`Answered:         ${report.answered}`);
  console.log(`Correct:          ${report.correct}`);
  console.log(`Accuracy:         ${(report.accuracy * 100).toFixed(1)}%`);
  console.log(`Source Hit Rate:  ${(report.sourceHitRate * 100).toFixed(1)}%`);
  console.log(`Avg Latency:      ${report.avgLatencyMs.toFixed(0)}ms`);

  console.log('\n--- By Difficulty ---');
  for (const [diff, stats] of Object.entries(report.byDifficulty)) {
    console.log(`  ${diff.padEnd(20)} ${stats.correct}/${stats.total} (${(stats.accuracy * 100).toFixed(1)}%)`);
  }

  console.log('\n--- By Category ---');
  for (const [cat, stats] of Object.entries(report.byCategory)) {
    console.log(`  ${cat.padEnd(24)} ${stats.correct}/${stats.total} (${(stats.accuracy * 100).toFixed(1)}%)`);
  }

  console.log(`\nMulti-statement accuracy:  ${(report.multiStatementAccuracy * 100).toFixed(1)}%`);
  console.log(`Single-statement accuracy: ${(report.singleStatementAccuracy * 100).toFixed(1)}%`);

  if (report.failures.length > 0) {
    console.log(`\n--- Failed Questions (${report.failures.length}) ---`);
    for (const f of report.failures) {
      console.log(`  ${f.id}: Expected ${f.expected}, Got ${f.got ?? 'NULL'}`);
      console.log(`    ${f.question.slice(0, 100)}...`);
    }
  }

  // Save results to file
  const modeTag = options.noRag ? 'norag' : 'rag';
  const modelTag = model.replace(/[^a-z0-9]/gi, '-');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(__dirname, `mcq-results-${modeTag}-${provider}-${modelTag}-${timestamp}.json`);
  fs.writeFileSync(outputPath, JSON.stringify({ mode: modeTag, provider, model, report, results }, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);

  if (pool) await pool.end();
}

// Parse CLI args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const noRag = args.includes('--no-rag');
const firstNIdx = args.indexOf('--first');
const firstN = firstNIdx >= 0 ? parseInt(args[firstNIdx + 1]) : undefined;
const questionIdx = args.indexOf('--question');
const questionId = questionIdx >= 0 ? args[questionIdx + 1] : undefined;
const modelIdx = args.indexOf('--model');
const model = modelIdx >= 0 ? args[modelIdx + 1] : undefined;
const providerIdx = args.indexOf('--provider');
const provider = providerIdx >= 0 ? args[providerIdx + 1] as 'openai' | 'gemini' : undefined;

runEvaluation({ dryRun, firstN, questionId, noRag, model, provider }).catch(console.error);
