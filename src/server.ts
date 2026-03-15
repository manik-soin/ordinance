import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { router } from './api/routes.js';
import { runMigrations } from './db/migrate.js';
import { ensureCacheTable } from './cache/semantic-cache.js';
import { getPool } from './db/pool.js';
import { startScheduler } from './scheduler/index.js';
import { createRateLimitMiddleware } from './security/rate-limit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

app.set('trust proxy', IS_PRODUCTION ? 1 : false);

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://www.googletagmanager.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "https://www.google-analytics.com", "https://*.google-analytics.com", "https://*.analytics.google.com", "https://*.googletagmanager.com"],
      imgSrc: ["'self'", "data:", "https://www.googletagmanager.com"],
    },
  },
}));

// CORS: restrict API to own origin in production
const ALLOWED_ORIGINS = process.env.NODE_ENV === 'production'
  ? ['https://ordinance.maniksoin.com', 'https://hk-compliance-api-production.up.railway.app']
  : undefined;
app.use(cors(ALLOWED_ORIGINS ? { origin: ALLOWED_ORIGINS } : undefined));

app.use(express.json({ limit: '16kb' }));

// Request ID middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = crypto.randomUUID();
  res.setHeader('X-Request-Id', requestId);
  next();
});

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (!req.path.endsWith('/health')) {
      console.log(
        `[${req.method}] ${req.path} ${res.statusCode} ${duration}ms`
      );
    }
  });
  next();
});

const burstRateLimitMiddleware = createRateLimitMiddleware([
  {
    name: 'query-minute',
    match: (req) => req.method === 'POST' && req.path === '/api/query',
    windowMs: envInt('QUERY_RATE_LIMIT_WINDOW_MS', 60_000),
    maxRequests: envInt('QUERY_RATE_LIMIT_MAX', 8),
    concurrencyLimit: envInt('QUERY_CONCURRENCY_LIMIT', 2),
    errorMessage: 'Too many requests. Please wait a moment before asking again.',
  },
  {
    name: 'query-daily',
    match: (req) => req.method === 'POST' && req.path === '/api/query',
    windowMs: envInt('QUERY_DAILY_LIMIT_WINDOW_MS', 24 * 60 * 60_000),
    maxRequests: envInt('QUERY_DAILY_LIMIT_MAX', 50),
    errorMessage: 'Daily query limit reached. Please try again tomorrow.',
  },
  {
    name: 'query-stream-minute',
    match: (req) => req.method === 'POST' && req.path === '/api/query/stream',
    windowMs: envInt('QUERY_STREAM_RATE_LIMIT_WINDOW_MS', 60_000),
    maxRequests: envInt('QUERY_STREAM_RATE_LIMIT_MAX', 4),
    concurrencyLimit: envInt('QUERY_STREAM_CONCURRENCY_LIMIT', 1),
    errorMessage: 'Streaming rate limit exceeded. Please wait a moment before trying again.',
  },
  {
    name: 'query-stream-daily',
    match: (req) => req.method === 'POST' && req.path === '/api/query/stream',
    windowMs: envInt('QUERY_STREAM_DAILY_LIMIT_WINDOW_MS', 24 * 60 * 60_000),
    maxRequests: envInt('QUERY_STREAM_DAILY_LIMIT_MAX', 25),
    errorMessage: 'Daily streaming limit reached. Please try again tomorrow.',
  },
]);

const dailyRateLimitMiddleware = createRateLimitMiddleware([
  {
    name: 'query-daily',
    match: (req) => req.method === 'POST' && req.path === '/api/query',
    windowMs: envInt('QUERY_DAILY_LIMIT_WINDOW_MS', 24 * 60 * 60_000),
    maxRequests: envInt('QUERY_DAILY_LIMIT_MAX', 50),
    errorMessage: 'Daily query limit reached. Please try again tomorrow.',
  },
  {
    name: 'query-stream-daily',
    match: (req) => req.method === 'POST' && req.path === '/api/query/stream',
    windowMs: envInt('QUERY_STREAM_DAILY_LIMIT_WINDOW_MS', 24 * 60 * 60_000),
    maxRequests: envInt('QUERY_STREAM_DAILY_LIMIT_MAX', 25),
    errorMessage: 'Daily streaming limit reached. Please try again tomorrow.',
  },
]);

app.use(burstRateLimitMiddleware);
app.use(dailyRateLimitMiddleware);

// Routes
app.use('/api', router);

// Serve frontend
const publicDir = path.resolve(__dirname, '..', 'public');
app.use(express.static(publicDir));

// SPA fallback — serve index.html for non-API routes
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Start
async function start(): Promise<void> {
  // Respond to health checks immediately
  const server = app.listen(PORT, () => {
    console.log(`[Server] Listening on port ${PORT}`);
  });

  // Run migrations in background (non-blocking)
  try {
    await runMigrations();
    console.log('[Server] Database migrations complete');
  } catch (err) {
    console.error('[Server] Migration error (non-fatal):', err);
  }

  // Create cache table after migrations (non-fatal)
  try {
    await ensureCacheTable(getPool());
    console.log('[Server] Cache table ready');
  } catch (err) {
    console.error('[Server] Cache table error (non-fatal):', err);
  }

  // Start scheduled scrape jobs (non-fatal)
  try {
    startScheduler();
    console.log('[Server] Scheduler started');
  } catch (err) {
    console.error('[Server] Scheduler error (non-fatal):', err);
  }

}

start().catch(console.error);

export { app };
