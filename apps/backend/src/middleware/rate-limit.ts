import { createMiddleware } from 'hono/factory';
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';

import { HTTP_STATUS } from '@/constants';
import { ERROR_CODES } from '@/lib/error-codes';
import { getRedis } from '@/lib/redis';
import { sendError } from '@/lib/response';
import { type AuthVariables } from '@/middleware/auth';

type RateLimitRule = {
  points: number;
  duration: number;
  blockDuration?: number;
};

type RateLimitPolicy = {
  guest: RateLimitRule;
};

/** MVP starting policies. Keep endpoint-specific limits here instead of scattering numbers across routes. */
export const RATE_LIMIT_POLICIES = {
  dictionaryLookup: {
    guest: { points: 60, duration: 10 * 60, blockDuration: 10 * 60 },
  },
} as const satisfies Record<string, RateLimitPolicy>;

type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;
const limiters = new Map<string, RateLimiterRedis>();

/**
 * The edge proxy must overwrite these headers before they reach the API.
 * Without a trusted proxy, the value is only a client-provided hint.
 */
export function getClientIp(c: { req: { header(name: string): string | undefined } }): string {
  const realIp = c.req.header('x-real-ip')?.trim();
  if (realIp) {
    return realIp;
  }

  const forwardedFor = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return forwardedFor || 'unknown';
}

function getLimiter(name: string, rule: RateLimitRule): RateLimiterRedis {
  const existing = limiters.get(name);
  if (existing) {
    return existing;
  }

  const limiter = new RateLimiterRedis({
    keyPrefix: `gloaming:ratelimit:${name}`,
    storeClient: getRedis(),
    points: rule.points,
    duration: rule.duration,
    blockDuration: rule.blockDuration,
    // Fall back to a per-process limiter if Redis is temporarily unavailable.
    insuranceLimiter: new RateLimiterMemory({
      points: rule.points,
      duration: rule.duration,
      blockDuration: rule.blockDuration,
    }),
  });

  limiters.set(name, limiter);
  return limiter;
}

function setRateLimitHeaders(
  c: { header(name: string, value: string): void },
  rule: RateLimitRule,
  result: RateLimiterRes,
) {
  c.header('X-RateLimit-Limit', String(rule.points));
  c.header('X-RateLimit-Remaining', String(Math.max(result.remainingPoints, 0)));
  c.header('X-RateLimit-Reset', String(Math.ceil((Date.now() + result.msBeforeNext) / 1000)));
}

/** Apply a Redis-backed policy after sessionMiddleware has identified the caller. */
export function rateLimit(policyName: RateLimitPolicyName) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const user = c.get('user');
    if (user) {
      return next();
    }

    const rule = RATE_LIMIT_POLICIES[policyName].guest;
    const identity = getClientIp(c);
    const limiter = getLimiter(`${policyName}:guest`, rule);

    try {
      const result = await limiter.consume(identity);
      setRateLimitHeaders(c, rule, result);
    } catch (error) {
      if (!(error instanceof RateLimiterRes)) {
        throw error;
      }

      const retryAfter = Math.max(1, Math.ceil(error.msBeforeNext / 1000));
      setRateLimitHeaders(c, rule, error);
      c.header('Retry-After', String(retryAfter));
      return sendError(c, ERROR_CODES.TOO_MANY_REQUESTS, HTTP_STATUS.TOO_MANY_REQUESTS);
    }

    await next();
  });
}
