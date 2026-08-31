import express from 'express';
import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { describe, expect, it } from 'vitest';
import { createRateLimitMiddleware } from '../../src/security/rate-limit.js';

function createApp() {
  const app = express();
  app.use(express.json());
  return app;
}

describe('rate limit middleware', () => {
  it('blocks requests after the configured burst limit', async () => {
    const app = createApp();
    app.use(createRateLimitMiddleware([
      {
        name: 'query',
        match: (req) => req.method === 'POST' && req.path === '/query',
        windowMs: 60_000,
        maxRequests: 2,
      },
    ]));
    app.post('/query', (_req, res) => {
      res.json({ ok: true });
    });

    await request(app).post('/query').send({ query: 'one' }).expect(200);
    await request(app).post('/query').send({ query: 'two' }).expect(200);
    const blocked = await request(app).post('/query').send({ query: 'three' }).expect(429);

    expect(blocked.body).toEqual({
      error: 'Too many requests. Please try again later.',
    });
    expect(blocked.headers['ratelimit-limit']).toBe('2');
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('enforces concurrency caps for long-running requests', async () => {
    const app = createApp();
    let releaseFirstRequest: (() => void) | undefined;
    let firstRequestStarted: (() => void) | undefined;
    const firstRequestEntered = new Promise<void>((resolve) => {
      firstRequestStarted = resolve;
    });
    const waitForRelease = new Promise<void>((resolve) => {
      releaseFirstRequest = resolve;
    });

    app.use(createRateLimitMiddleware([
      {
        name: 'query-stream',
        match: (req) => req.method === 'POST' && req.path === '/query/stream',
        windowMs: 60_000,
        maxRequests: 10,
        concurrencyLimit: 1,
      },
    ]));
    app.post('/query/stream', async (_req, res) => {
      firstRequestStarted?.();
      await waitForRelease;
      res.json({ ok: true });
    });

    const firstRequest = new Promise<SupertestResponse>((resolve, reject) => {
      request(app)
        .post('/query/stream')
        .send({ query: 'one' })
        .end((err, res) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(res);
        });
    });
    await firstRequestEntered;

    const blocked = await request(app)
      .post('/query/stream')
      .send({ query: 'two' })
      .expect(429);

    expect(blocked.body).toEqual({
      error: 'Too many concurrent requests. Please wait for the current response to finish.',
    });

    releaseFirstRequest?.();
    const firstResponse = await firstRequest;
    expect(firstResponse.status).toBe(200);
    await request(app).post('/query/stream').send({ query: 'three' }).expect(200);
  });
});
