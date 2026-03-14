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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT ?? '3000', 10);

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
    },
  },
}));
app.use(cors());
app.use(express.json({ limit: '1mb' }));

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
    if (req.path !== '/api/health') {
      console.log(
        `[${req.method}] ${req.path} ${res.statusCode} ${duration}ms`
      );
    }
  });
  next();
});

// Simple in-memory rate limiter (per IP, 30 requests per minute for query endpoints)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    next();
    return;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    res.status(429).json({ error: 'Too many requests. Please try again later.' });
    return;
  }

  entry.count++;
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
app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Start
async function start(): Promise<void> {
  // Respond to health checks immediately
  const server = app.listen(PORT, () => {
    console.log(`[Server] Listening on port ${PORT}`);
  });

  // Run migrations in background
  try {
    await runMigrations();
    console.log('[Server] Database migrations complete');
  } catch (err) {
    console.error('[Server] Migration error (non-fatal):', err);
  }

  // Cleanup rate limit map periodically
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap) {
      if (now > entry.resetAt) {
        rateLimitMap.delete(ip);
      }
    }
  }, RATE_LIMIT_WINDOW_MS);
}

start().catch(console.error);

export { app };
