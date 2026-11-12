import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';

import { getRedis } from '@/server/infra/cache';
import { jsonError } from '@/server/infra/http/next-json';
import { rootLogger } from '@/server/infra/logging/logger';
import { HTTP_STATUS } from '@/server/shared/constants';
import { ERROR_CODES } from '@/server/shared/errors/codes';

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

/** MVP starting policies — keep numbers here, not scattered across Route Handlers. */
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

export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;
export type AiRateLimitPolicyName = keyof typeof AI_RATE_LIMIT_POLICIES;

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
 * Edge proxy should overwrite these before they reach the app.
 * Without a trusted proxy, the value is only a client-provided hint.
 */
export function getClientIpFromRequest(request: Request): string {
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) {
    return realIp;
  }
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
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
    insuranceLimiter: new RateLimiterMemory({
      points: rule.points,
      duration: rule.duration,
      blockDuration: rule.blockDuration,
    }),
  });

  limiters.set(name, limiter);
  return limiter;
}

function rateLimitHeaders(rule: RateLimitRule, result: RateLimiterRes): HeadersInit {
  return {
    'X-RateLimit-Limit': String(rule.points),
    'X-RateLimit-Remaining': String(Math.max(result.remainingPoints, 0)),
    'X-RateLimit-Reset': String(Math.ceil((Date.now() + result.msBeforeNext) / 1000)),
  };
}

function tooManyRequests(request: Request, headers?: HeadersInit): Response {
  const response = jsonError(request, ERROR_CODES.TOO_MANY_REQUESTS, HTTP_STATUS.TOO_MANY_REQUESTS);
  if (!headers) {
    return response;
  }
  const merged = new Headers(response.headers);
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      merged.set(key, value);
    }
  }
  return new Response(response.body, { status: response.status, headers: merged });
}

/** Guest-only policy (authenticated callers skip). Returns a Response when blocked. */
export async function enforceGuestRateLimit(
  request: Request,
  policyName: RateLimitPolicyName,
  options: { isAuthenticated: boolean },
): Promise<Response | null> {
  if (options.isAuthenticated) {
    return null;
  }

  const rule = RATE_LIMIT_POLICIES[policyName].guest;
  const identity = getClientIpFromRequest(request);
  const limiter = getLimiter(`${policyName}:guest`, rule);

  try {
    await limiter.consume(identity);
    return null;
  } catch (error) {
    if (!(error instanceof RateLimiterRes)) {
      throw error;
    }
    const retryAfter = Math.max(1, Math.ceil(error.msBeforeNext / 1000));
    return tooManyRequests(request, {
      ...rateLimitHeaders(rule, error),
      'Retry-After': String(retryAfter),
    });
  }
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

export type AiRateLimitLease = {
  release: () => Promise<void>;
};

/**
 * Authenticated AI endpoint guard: user + IP quotas and a concurrency slot.
 * Caller must `release()` when the response stream finishes (or on early error).
 */
export async function acquireAiRateLimit(
  request: Request,
  policyName: AiRateLimitPolicyName,
  userId: string,
): Promise<{ ok: true; lease: AiRateLimitLease } | { ok: false; response: Response }> {
  const policy = AI_RATE_LIMIT_POLICIES[policyName];
  const ip = getClientIpFromRequest(request);
  const userLimiter = getLimiter(`${policyName}:user`, policy.user);
  const ipLimiter = getLimiter(`${policyName}:ip`, policy.ip);

  try {
    await userLimiter.consume(userId);
    await ipLimiter.consume(ip);
  } catch (error) {
    if (!(error instanceof RateLimiterRes)) {
      throw error;
    }
    const retryAfter = Math.max(1, Math.ceil(error.msBeforeNext / 1000));
    return {
      ok: false,
      response: tooManyRequests(request, { 'Retry-After': String(retryAfter) }),
    };
  }

  const acquired = await acquireConcurrentSlot(policyName, userId);
  if (!acquired) {
    return {
      ok: false,
      response: tooManyRequests(request, { 'Retry-After': '1' }),
    };
  }

  let released = false;
  const release = async () => {
    if (released) {
      return;
    }
    released = true;
    try {
      await releaseConcurrentSlot(policyName, userId);
    } catch (error) {
      rateLimitLogger.warn({ err: error, policyName, userId }, 'Failed to release AI concurrency slot');
    }
  };

  return { ok: true, lease: { release } };
}

/** Wrap an SSE/streaming Response so the concurrency slot releases when the body ends. */
export function withAiRateLimitRelease(response: Response, lease: AiRateLimitLease): Response {
  if (!response.body) {
    void lease.release();
    return response;
  }

  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          controller.close();
          await lease.release();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        await lease.release();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        await lease.release();
      }
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
