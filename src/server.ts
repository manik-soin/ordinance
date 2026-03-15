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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT ?? '3000', 10);

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

// Rate limiter: 8 requests per minute + 50 per day per IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const dailyBudgetMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 8;
const DAILY_LIMIT_MAX = 50;
const DAILY_WINDOW_MS = 24 * 60 * 60_000;

function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  const now = Date.now();

  // Per-minute check
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  } else if (entry.count >= RATE_LIMIT_MAX) {
    res.status(429).json({ error: 'Too many requests. Please wait a moment before asking again.' });
    return;
  } else {
    entry.count++;
  }

  // Daily budget check
  const daily = dailyBudgetMap.get(ip);
  if (!daily || now > daily.resetAt) {
    dailyBudgetMap.set(ip, { count: 1, resetAt: now + DAILY_WINDOW_MS });
  } else if (daily.count >= DAILY_LIMIT_MAX) {
    res.status(429).json({ error: 'Daily query limit reached. Please try again tomorrow.' });
    return;
  } else {
    daily.count++;
  }

  next();
}

// Apply rate limiting to query endpoints
app.use('/api/query', rateLimiter);

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

  // Cleanup rate limit maps periodically
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap) {
      if (now > entry.resetAt) rateLimitMap.delete(ip);
    }
    for (const [ip, entry] of dailyBudgetMap) {
      if (now > entry.resetAt) dailyBudgetMap.delete(ip);
    }
  }, RATE_LIMIT_WINDOW_MS);
}

start().catch(console.error);

export { app };
