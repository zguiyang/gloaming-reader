import { createMiddleware } from 'hono/factory';
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';

import { HTTP_STATUS } from '@/constants';
import { ERROR_CODES } from '@/lib/error-codes';
import { rootLogger } from '@/lib/logger';
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

type AiRateLimitPolicy = {
  user: RateLimitRule;
  ip: RateLimitRule;
  maxConcurrent: number;
};

/** MVP starting policies. Keep endpoint-specific limits here instead of scattering numbers across routes. */
export const RATE_LIMIT_POLICIES = {
  dictionaryLookup: {
    guest: { points: 60, duration: 10 * 60, blockDuration: 10 * 60 },
  },
} as const satisfies Record<string, RateLimitPolicy>;

export const AI_RATE_LIMIT_POLICIES = {
  assist: {
    user: { points: 10, duration: 60, blockDuration: 60 },
    ip: { points: 60, duration: 60, blockDuration: 60 },
    maxConcurrent: 2,
  },
  translate: {
    user: { points: 20, duration: 60, blockDuration: 60 },
    ip: { points: 120, duration: 60, blockDuration: 60 },
    maxConcurrent: 3,
  },
} as const satisfies Record<string, AiRateLimitPolicy>;

type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;
type AiRateLimitPolicyName = keyof typeof AI_RATE_LIMIT_POLICIES;
const limiters = new Map<string, RateLimiterRedis>();
const rateLimitLogger = rootLogger.child({ module: 'RateLimit' });
const CONCURRENCY_SLOT_TTL_SECONDS = 5 * 60;

const ACQUIRE_CONCURRENCY_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current >= tonumber(ARGV[1]) then
  return 0
end
local next = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return next
`;

const RELEASE_CONCURRENCY_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if not current or current <= 1 then
  return redis.call('DEL', KEYS[1])
end
return redis.call('DECR', KEYS[1])
`;

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

function concurrentKey(policyName: AiRateLimitPolicyName, userId: string): string {
  return `gloaming:ratelimit:${policyName}:concurrent:${userId}`;
}

async function acquireConcurrentSlot(policyName: AiRateLimitPolicyName, userId: string): Promise<boolean> {
  const policy = AI_RATE_LIMIT_POLICIES[policyName];
  const result = await getRedis().eval(
    ACQUIRE_CONCURRENCY_SCRIPT,
    1,
    concurrentKey(policyName, userId),
    String(policy.maxConcurrent),
    String(CONCURRENCY_SLOT_TTL_SECONDS),
  );
  return Number(result) > 0;
}

async function releaseConcurrentSlot(policyName: AiRateLimitPolicyName, userId: string): Promise<void> {
  await getRedis().eval(RELEASE_CONCURRENCY_SCRIPT, 1, concurrentKey(policyName, userId));
}

/** Protect authenticated, provider-backed endpoints by user, IP, and active streams. */
export function aiRateLimit(policyName: AiRateLimitPolicyName) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const user = c.get('user');
    if (!user) {
      return sendError(c, ERROR_CODES.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    }

    const policy = AI_RATE_LIMIT_POLICIES[policyName];
    const ip = getClientIp(c);
    const userLimiter = getLimiter(`${policyName}:user`, policy.user);
    const ipLimiter = getLimiter(`${policyName}:ip`, policy.ip);

    try {
      const userResult = await userLimiter.consume(user.id);
      setRateLimitHeaders(c, policy.user, userResult);
      await ipLimiter.consume(ip);
    } catch (error) {
      if (!(error instanceof RateLimiterRes)) {
        throw error;
      }
      const retryAfter = Math.max(1, Math.ceil(error.msBeforeNext / 1000));
      c.header('Retry-After', String(retryAfter));
      return sendError(c, ERROR_CODES.TOO_MANY_REQUESTS, HTTP_STATUS.TOO_MANY_REQUESTS);
    }

    const acquired = await acquireConcurrentSlot(policyName, user.id);
    if (!acquired) {
      c.header('Retry-After', '1');
      return sendError(c, ERROR_CODES.TOO_MANY_REQUESTS, HTTP_STATUS.TOO_MANY_REQUESTS);
    }

    let released = false;
    const release = async () => {
      if (released) {
        return;
      }
      released = true;
      try {
        await releaseConcurrentSlot(policyName, user.id);
      } catch (error) {
        // The TTL is the final guard if Redis is unavailable during cleanup.
        rateLimitLogger.warn({ err: error, policyName, userId: user.id }, 'Failed to release AI concurrency slot');
      }
    };

    try {
      await next();
      const response = c.res;
      if (!response.body) {
        await release();
        return;
      }

      const reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const result = await reader.read();
            if (result.done) {
              controller.close();
              await release();
              return;
            }
            controller.enqueue(result.value);
          } catch (error) {
            await release();
            controller.error(error);
          }
        },
        async cancel(reason) {
          try {
            await reader.cancel(reason);
          } finally {
            await release();
          }
        },
      });
      c.res = new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      await release();
      throw error;
    }
  });
}
