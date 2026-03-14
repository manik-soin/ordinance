import { Router } from 'express';
import type { Request, Response } from 'express';
import { getPool } from '../db/pool.js';
import { validateQueryInput } from '../safety/guardrails.js';
import { queryPipeline } from '../pipeline/query.js';
import { streamAnswer } from '../generator/index.js';
import { hybridSearch } from '../retrieval/hybrid-search.js';
import { rerank } from '../retrieval/reranker.js';
import { getSourceStats } from '../db/store.js';
import { checkForChanges } from '../scheduler/index.js';
import { BD_CODES_OF_PRACTICE } from '../sources/buildings-dept.js';

export const router = Router();

/**
 * POST /api/query — Ask a compliance question
 */
router.post('/query', async (req: Request, res: Response) => {
  const validation = validateQueryInput(req.body);

  if (!validation.valid || !validation.data) {
    res.status(400).json({
      error: validation.error,
      injectionDetected: validation.injectionDetected,
    });
    return;
  }

  try {
    const pool = getPool();
    const result = await queryPipeline(pool, validation.data.query, {
      filter: validation.data.filter,
    });

    res.json({
      answer: result.answer,
      citations: result.citations,
      sources: result.sources.map((s) => ({
        document_name: s.document_name,
        department: s.source_department,
        version: s.version,
        section: s.section_hierarchy,
        page: s.page_number,
        score: s.score,
      })),
      quality: {
        faithfulness: result.faithfulness.score,
        citationAccuracy: result.verification.citationAccuracy,
        phantomCitations: result.verification.phantomCitations.length,
        uncitedClaims: result.verification.uncitedClaims.length,
      },
      audit_id: result.auditId,
      latency_ms: result.latencyMs,
      model: result.model,
    });
  } catch (err) {
    console.error('[API] Query error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/query/stream — SSE streaming query
 */
router.post('/query/stream', async (req: Request, res: Response) => {
  const validation = validateQueryInput(req.body);

  if (!validation.valid || !validation.data) {
    res.status(400).json({ error: validation.error });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const pool = getPool();

    // Retrieve context first
    res.write(`data: ${JSON.stringify({ type: 'status', message: 'Retrieving relevant regulations...' })}\n\n`);

    const context = await hybridSearch(pool, validation.data.query, {
      filter: validation.data.filter,
      topK: 5,
    });

    const reranked = await rerank(validation.data.query, context, { topK: 3 });

    res.write(`data: ${JSON.stringify({ type: 'sources', sources: reranked.map((s) => ({ document_name: s.document_name, department: s.source_department, section: s.section_hierarchy })) })}\n\n`);

    // Stream answer
    res.write(`data: ${JSON.stringify({ type: 'status', message: 'Generating answer...' })}\n\n`);

    for await (const chunk of streamAnswer(validation.data.query, reranked)) {
      res.write(`data: ${JSON.stringify({ type: 'token', content: chunk })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[API] Stream error:', err);
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Internal server error' })}\n\n`);
    res.end();
  }
});

/**
 * GET /api/health — Health check
 */
router.get('/health', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const { rows: dbCheck } = await pool.query('SELECT 1 AS ok');
    const { rows: countRows } = await pool.query(
      'SELECT COUNT(*) AS count FROM regulation_chunks WHERE is_current = true'
    );
    const { rows: scrapeRows } = await pool.query(
      'SELECT MAX(completed_at) AS last_scrape FROM scrape_log'
    );

    res.json({
      status: 'healthy',
      database: dbCheck[0]?.ok === 1,
      documentChunks: Number(countRows[0]?.count ?? 0),
      lastScrape: scrapeRows[0]?.last_scrape ?? null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/sources — List ingested regulation sources
 */
router.get('/sources', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const stats = await getSourceStats(pool);
    res.json({ sources: stats });
  } catch (err) {
    console.error('[API] Sources error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/audit/:id — Get audit log entry
 */
router.get('/audit/:id', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      'SELECT * FROM query_audit_log WHERE id = $1',
      [req.params.id]
    );

    if (rows.length === 0) {
      res.status(404).json({ error: 'Audit entry not found' });
      return;
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('[API] Audit error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/scrape — Trigger manual scrape
 */
router.post('/admin/scrape', async (_req: Request, res: Response) => {
  try {
    const result = await checkForChanges(BD_CODES_OF_PRACTICE);
    res.json(result);
  } catch (err) {
    console.error('[API] Scrape error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/changes — Recent regulation changes
 */
router.get('/admin/changes', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM document_versions
       WHERE fetched_at > NOW() - INTERVAL '30 days'
       ORDER BY fetched_at DESC
       LIMIT 50`
    );
    res.json({ changes: rows });
  } catch (err) {
    console.error('[API] Changes error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
