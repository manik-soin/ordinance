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
import {
  checkBulkFreshness,
  getDocumentSourceUrls,
  detectNewBDCirculars,
  detectNewFSDCirculars,
} from './live-data.js';
import {
  fetchGovDataSummary,
  fetchFireDoorsets,
  fetchFireGlazing,
  fetchFireStopMaterials,
  fetchMiCSystems,
  fetchFireSafetyCompliance,
  searchLocation,
} from './gov-data.js';

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

    // Retrieve context (skip query expansion for faster TTFB)
    res.write(`data: ${JSON.stringify({ type: 'status', message: 'Retrieving relevant regulations...' })}\n\n`);

    const context = await hybridSearch(pool, validation.data.query, {
      filter: validation.data.filter,
      topK: 12,
    });

    const reranked = await rerank(validation.data.query, context, { topK: 6 });

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

    // These may fail before migrations — handle gracefully
    let documentChunks = 0;
    let lastScrape = null;
    try {
      const { rows: countRows } = await pool.query(
        'SELECT COUNT(*) AS count FROM regulation_chunks WHERE is_current = true'
      );
      documentChunks = Number(countRows[0]?.count ?? 0);
      const { rows: scrapeRows } = await pool.query(
        'SELECT MAX(completed_at) AS last_scrape FROM scrape_log'
      );
      lastScrape = scrapeRows[0]?.last_scrape ?? null;
    } catch {
      // Tables don't exist yet — that's OK for health check
    }

    res.json({
      status: 'healthy',
      database: dbCheck[0]?.ok === 1,
      documentChunks,
      lastScrape,
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

// ─── LIVE DATA APIs ───────────────────────────────────────────────────────────

/**
 * GET /api/live/freshness — Check if ingested documents are still current.
 * Issues HEAD requests to source URLs and compares Last-Modified headers.
 */
router.get('/live/freshness', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const docs = await getDocumentSourceUrls(pool);

    if (docs.length === 0) {
      res.json({ documents: [], summary: { total: 0, stale: 0, fresh: 0 } });
      return;
    }

    // Check up to 20 at a time to avoid overloading
    const toCheck = docs.slice(0, 20);
    const results = await checkBulkFreshness(toCheck);

    const stale = results.filter((r) => r.is_stale);
    res.json({
      documents: results,
      summary: {
        total: results.length,
        stale: stale.length,
        fresh: results.length - stale.length,
        checked_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[API] Freshness check error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/live/new-circulars — Detect newly published circular letters
 * from BD and FSD by probing known URL patterns.
 */
router.get('/live/new-circulars', async (_req: Request, res: Response) => {
  try {
    const [bdCirculars, fsdCirculars] = await Promise.all([
      detectNewBDCirculars(),
      detectNewFSDCirculars(),
    ]);

    res.json({
      bd: bdCirculars,
      fsd: fsdCirculars,
      total: bdCirculars.length + fsdCirculars.length,
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[API] Circular detection error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/live/status — Combined live data status dashboard.
 * Returns freshness summary + new circular count + data currency.
 */
router.get('/live/status', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();

    // Run all live checks in parallel
    const [docs, bdCirculars, fsdCirculars, healthData] = await Promise.all([
      getDocumentSourceUrls(pool).then((d) =>
        checkBulkFreshness(d.slice(0, 10))
      ),
      detectNewBDCirculars(),
      detectNewFSDCirculars(),
      pool.query(
        'SELECT COUNT(*) AS chunks FROM regulation_chunks WHERE is_current = true'
      ),
    ]);

    const staleCount = docs.filter((d) => d.is_stale).length;
    const totalChunks = Number(
      (healthData.rows[0] as Record<string, unknown>)?.chunks ?? 0
    );

    res.json({
      status: staleCount === 0 ? 'current' : 'updates_available',
      data: {
        total_chunks: totalChunks,
        documents_checked: docs.length,
        stale_documents: staleCount,
        fresh_documents: docs.length - staleCount,
      },
      new_circulars: {
        bd: bdCirculars.length,
        fsd: fsdCirculars.length,
        total: bdCirculars.length + fsdCirculars.length,
      },
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[API] Live status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GOVERNMENT OPEN DATA APIs ────────────────────────────────────────────────

/**
 * GET /api/gov/summary — Fetch summary of all BD open datasets from data.gov.hk.
 * Returns counts and samples of fire doorsets, glazing, materials, MiC, fire safety.
 */
router.get('/gov/summary', async (_req: Request, res: Response) => {
  try {
    const summary = await fetchGovDataSummary();
    res.json({ source: 'data.gov.hk', department: 'BD', ...summary });
  } catch (err) {
    console.error('[API] Gov data summary error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/gov/fire-doorsets — BD Central Data Bank: approved fire resisting doorsets.
 * Live data from data.gov.hk.
 */
router.get('/gov/fire-doorsets', async (_req: Request, res: Response) => {
  try {
    const data = await fetchFireDoorsets();
    res.json({ source: 'data.gov.hk/bd/opendata/cdbbc/cdbfrd.csv', count: data.length, data });
  } catch (err) {
    console.error('[API] Fire doorsets error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/gov/fire-glazing — BD Central Data Bank: approved fire resisting glazing.
 */
router.get('/gov/fire-glazing', async (_req: Request, res: Response) => {
  try {
    const data = await fetchFireGlazing();
    res.json({ source: 'data.gov.hk/bd/opendata/cdbbc/cdbfrg.csv', count: data.length, data });
  } catch (err) {
    console.error('[API] Fire glazing error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/gov/fire-stop-materials — BD Central Data Bank: approved fire stop materials.
 */
router.get('/gov/fire-stop-materials', async (_req: Request, res: Response) => {
  try {
    const data = await fetchFireStopMaterials();
    res.json({ source: 'data.gov.hk/bd/opendata/cdbbm/cdbfsm.csv', count: data.length, data });
  } catch (err) {
    console.error('[API] Fire stop materials error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/gov/mic-systems — BD accepted Modular Integrated Construction systems.
 */
router.get('/gov/mic-systems', async (_req: Request, res: Response) => {
  try {
    const data = await fetchMiCSystems();
    res.json({ source: 'data.gov.hk/bd/opendata/mic/mic.csv', count: data.length, data });
  } catch (err) {
    console.error('[API] MiC systems error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/gov/fire-safety — Fire safety compliance statistics (Cap 502/572).
 */
router.get('/gov/fire-safety', async (_req: Request, res: Response) => {
  try {
    const data = await fetchFireSafetyCompliance();
    res.json({ source: 'data.gov.hk/bd/opendata/fso/fso.csv', count: data.length, data });
  } catch (err) {
    console.error('[API] Fire safety compliance error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/gov/location?q=query — Search buildings/locations via GeoData API.
 */
router.get('/gov/location', async (req: Request, res: Response) => {
  const query = (req.query.q as string) ?? '';
  if (!query) {
    res.status(400).json({ error: 'Missing q parameter' });
    return;
  }
  try {
    const results = await searchLocation(query);
    res.json({ source: 'geodata.gov.hk', query, count: results.length, results });
  } catch (err) {
    console.error('[API] Location search error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
