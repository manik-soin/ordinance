import type { NextFunction, Request, Response } from 'express';

export interface RateLimitPolicy {
  name: string;
  match(req: Request): boolean;
  windowMs: number;
  maxRequests: number;
  concurrencyLimit?: number;
  errorMessage?: string;
}

interface SlidingWindowState {
  hits: number[];
}

function getClientKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

function getResetTimestamp(hits: number[], now: number, windowMs: number): number {
  if (hits.length === 0) {
    return now + windowMs;
  }
  return hits[0] + windowMs;
}

function pruneHits(hits: number[] | undefined, windowMs: number, now: number): number[] {
  if (!hits?.length) {
    return [];
  }
  const windowStart = now - windowMs;
  return hits.filter((timestamp) => timestamp > windowStart);
}

function setRateLimitHeaders(
  res: Response,
  policy: RateLimitPolicy,
  remaining: number,
  resetAt: number
): void {
  const resetSeconds = Math.max(Math.ceil((resetAt - Date.now()) / 1000), 0);
  res.setHeader('RateLimit-Policy', `${policy.name};w=${Math.ceil(policy.windowMs / 1000)}`);
  res.setHeader('RateLimit-Limit', String(policy.maxRequests));
  res.setHeader('RateLimit-Remaining', String(Math.max(remaining, 0)));
  res.setHeader('RateLimit-Reset', String(resetSeconds));
  res.setHeader('X-RateLimit-Limit', String(policy.maxRequests));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(remaining, 0)));
  res.setHeader('X-RateLimit-Reset', String(resetSeconds));
}

export function createRateLimitMiddleware(policies: RateLimitPolicy[]) {
  const requestWindows = new Map<string, SlidingWindowState>();
  const activeRequests = new Map<string, number>();

  return function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const policy = policies.find((candidate) => candidate.match(req));
    if (!policy) {
      next();
      return;
    }

    const clientKey = getClientKey(req);
    const now = Date.now();
    const rateKey = `${policy.name}:${clientKey}`;
    const activeKey = `active:${policy.name}:${clientKey}`;
    const prunedHits = pruneHits(requestWindows.get(rateKey)?.hits, policy.windowMs, now);

    if (prunedHits.length >= policy.maxRequests) {
      const resetAt = getResetTimestamp(prunedHits, now, policy.windowMs);
      setRateLimitHeaders(res, policy, 0, resetAt);
      res.setHeader('Retry-After', String(Math.max(Math.ceil((resetAt - now) / 1000), 1)));
      res.status(429).json({
        error: policy.errorMessage ?? 'Too many requests. Please try again later.',
      });
      return;
    }

    const activeCount = activeRequests.get(activeKey) ?? 0;
    if (policy.concurrencyLimit && activeCount >= policy.concurrencyLimit) {
      const resetAt = getResetTimestamp(prunedHits, now, policy.windowMs);
      setRateLimitHeaders(
        res,
        policy,
        policy.maxRequests - prunedHits.length,
        resetAt
      );
      res.status(429).json({
        error: 'Too many concurrent requests. Please wait for the current response to finish.',
      });
      return;
    }

    prunedHits.push(now);
    requestWindows.set(rateKey, { hits: prunedHits });
    setRateLimitHeaders(
      res,
      policy,
      policy.maxRequests - prunedHits.length,
      getResetTimestamp(prunedHits, now, policy.windowMs)
    );

    if (policy.concurrencyLimit) {
      activeRequests.set(activeKey, activeCount + 1);
      let released = false;
      const release = () => {
        if (released) {
          return;
        }
        released = true;
        const current = activeRequests.get(activeKey) ?? 1;
        if (current <= 1) {
          activeRequests.delete(activeKey);
        } else {
          activeRequests.set(activeKey, current - 1);
        }
      };

      res.once('finish', release);
      res.once('close', release);
    }

    next();
  };
}
