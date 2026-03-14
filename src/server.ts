import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { router } from './api/routes.js';
import { runMigrations } from './db/migrate.js';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT ?? '3000', 10);

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Routes
app.use('/api', router);

// Root
app.get('/', (_req, res) => {
  res.json({
    name: 'HK Compliance RAG',
    version: '0.1.0',
    docs: '/api/health',
  });
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
}

start().catch(console.error);

export { app };
