/**
 * Live smoke test for the agent path.
 * Usage:
 *   npx tsx scripts/agent-smoke.ts              # dev DB from .env
 *   TARGET_DB=prod npx tsx scripts/agent-smoke.ts  # neondb on the same endpoint
 *
 * Exercises: router sanity, static delegation, cross-reference chase,
 * freshness via gov_lookup, and comparison fan-out with subagents.
 */
import 'dotenv/config';
import { getPool, closePool } from '../src/db/pool.js';
import { agentQuery, routeComplexity } from '../src/agent/index.js';
import type { AgentQueryResult } from '../src/agent/types.js';

function printResult(label: string, result: AgentQueryResult): void {
  console.log(`\n${'='.repeat(70)}\n${label}`);
  console.log(`path=${result.path} reasons=[${result.routeReasons.join(', ')}] model=${result.model} latency=${result.latencyMs}ms cost=$${result.cost?.costUsd.toFixed(4) ?? '?'}`);
  if (result.trace) {
    console.log(`steps=${result.trace.steps.length}/${result.trace.stepBudget} budgetExhausted=${result.trace.budgetExhausted} retries=${result.trace.verificationRetries} subagents=${result.trace.subagentRuns}`);
    for (const step of result.trace.steps) {
      const args = JSON.stringify(step.args ?? {}).slice(0, 100);
      console.log(`  [step ${step.step}] ${step.tool} ${args}`);
      console.log(`     obs: ${step.observation.replace(/\n/g, ' | ').slice(0, 160)}`);
    }
  }
  console.log(`quality: faithfulness=${result.faithfulness.score}/10 citationAccuracy=${result.verification.citationAccuracy} phantoms=${result.verification.phantomCitations.length}`);
  console.log(`memory: ${JSON.stringify(result.projectMemory)}`);
  console.log(`sources: ${[...new Set(result.sources.map((s) => s.document_name))].slice(0, 4).join(' | ')}`);
  console.log(`answer (first 500 chars):\n${result.answer.slice(0, 500)}`);
}

async function main(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL!);
  if (process.env.TARGET_DB === 'prod') url.pathname = '/neondb';
  const pool = getPool(url.toString());

  const { rows } = await pool.query("SELECT COUNT(*) AS n FROM regulation_chunks WHERE is_current = true");
  console.log(`DB ${url.pathname} chunks: ${rows[0].n}`);

  const routes = [
    'What is the minimum fire resistance period for structural elements?',
    'Is the fire door model REGAL still on the approved list?',
    'Compare the means-of-escape requirements across residential and commercial occupancies',
    'The regulations say escape routes are subject to Part IV. What does that part actually require?',
    'Does my 12-storey residential building meet the means-of-escape rules?',
  ];
  console.log('\nROUTER:');
  for (const q of routes) {
    const d = routeComplexity(q);
    console.log(`  [${d.path}] (${d.reasons.join(',')}) ${q.slice(0, 70)}`);
  }

  printResult(
    'STATIC PATH: single-hop lookup',
    await agentQuery(pool, 'What is the minimum fire resistance period for structural elements?', {})
  );

  printResult(
    'AGENT PATH: cross-reference chase',
    await agentQuery(
      pool,
      'The regulations say escape routes are subject to Part IV. What does that part actually require?',
      {}
    )
  );

  printResult(
    'AGENT PATH: freshness / gov_lookup',
    await agentQuery(pool, 'Is the fire door model REGAL still on the approved list?', {})
  );

  printResult(
    'AGENT PATH: comparison fan-out',
    await agentQuery(
      pool,
      'Compare the means-of-escape requirements across residential and commercial occupancies',
      {}
    )
  );

  await closePool();
}

main().catch((err) => {
  console.error('SMOKE FAILED:', err);
  process.exit(1);
});
