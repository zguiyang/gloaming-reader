import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';

import { getRedis } from '@/server/infra/cache';
import { env } from '@/server/infra/config/env';
import { jsonError } from '@/server/infra/http/next-json';
import { createLogger } from '@/server/infra/logging/logger';
import { HTTP_STATUS } from '@/server/shared/constants';
import { ERROR_CODES } from '@/server/shared/errors/codes';

type RateLimitRule = {
  points: number;
  duration: number;
  blockDuration?: number;
};

type RateLimitPolicy = {
  /** Anonymous quota; a policy without one deliberately grants guests no quota. */
  guest?: RateLimitRule;
  /** Optional quota for signed-in callers, keyed by user id. */
  user?: RateLimitRule;
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
    // Signed-in lookups still reach external providers and AI enrichment, so they
    // get the same budget as guests instead of no quota at all.
    user: { points: 60, duration: 10 * 60, blockDuration: 10 * 60 },
  },
  /** Manual "test connection" / model listing / balance probes, one outbound call each. */
  outboundProbe: {
    user: { points: 30, duration: 60, blockDuration: 60 },
  },
  /** Personal EPUB upload (up to 50 MB plus a parse enqueue). */
  epubUpload: {
    user: { points: 10, duration: 10 * 60, blockDuration: 10 * 60 },
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
  /** On-demand TTS synthesis (paid Azure call). Counts the synthesis entry point only. */
  ttsSynthesis: {
    user: { points: 60, duration: 60, blockDuration: 60 },
    ip: { points: 120, duration: 60, blockDuration: 60 },
    maxConcurrent: 4,
  },
  /** Per-tag AI translation completion (LLM call per missing locale). */
  tagTranslation: {
    user: { points: 10, duration: 60, blockDuration: 60 },
    ip: { points: 60, duration: 60, blockDuration: 60 },
    maxConcurrent: 2,
  },
} as const satisfies Record<string, AiRateLimitPolicy>;

export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;
export type AiRateLimitPolicyName = keyof typeof AI_RATE_LIMIT_POLICIES;

const limiters = new Map<string, RateLimiterRedis>();
const rateLimitLogger = createLogger('RateLimit');
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

/** Cloudflare always overwrites `CF-Connecting-IP` before the Worker sees it. */
function isCloudflareWorkersRuntime(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';
}

function trustsProxyHeaders(): boolean {
  return env.TRUST_PROXY_HEADERS || isCloudflareWorkersRuntime();
}

/**
 * Best-effort client IP for rate-limit keys.
 *
 * Header values are only trustworthy when a proxy rewrites them. Cloudflare
 * Workers always run behind Cloudflare and receive an overwritten
 * `CF-Connecting-IP`; any other deployment must opt in with
 * `TRUST_PROXY_HEADERS=true`. Without that trust we cannot see the peer
 * address, so callers share the `unknown` bucket instead of letting a client
 * choose its own key by rotating a header.
 *
 * When trusted, prefer single-valued or proxy-appended headers:
 * `CF-Connecting-IP`, then the *rightmost* `X-Forwarded-For` hop, then
 * `X-Real-IP`. Taking the leftmost hop would let a client pick its own key.
 */
export function getClientIpFromRequest(request: Request): string {
  if (!trustsProxyHeaders()) {
    return 'unknown';
  }

  const cloudflareIp = request.headers.get('cf-connecting-ip')?.trim();
  if (cloudflareIp) {
    return cloudflareIp;
  }

  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const hops = forwardedFor
      .split(',')
      .map((hop) => hop.trim())
      .filter(Boolean);
    const nearestHop = hops.at(-1);
    if (nearestHop) {
      return nearestHop;
    }
  }

  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) {
    return realIp;
  }
  return 'unknown';
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

/**
 * The quota store is a hard dependency: a per-process fallback would multiply
 * every budget by the number of instances, so an unavailable store fails
 * closed instead of silently granting extra requests.
 */
function rateLimitUnavailable(request: Request): Response {
  return jsonError(request, ERROR_CODES.RATE_LIMIT.UNAVAILABLE, HTTP_STATUS.SERVICE_UNAVAILABLE);
}

/** Consume one fixed-window bucket; returns a 429 Response when the caller is over budget. */
async function consumeLimit(
  request: Request,
  limiterName: string,
  rule: RateLimitRule,
  key: string,
): Promise<Response | null> {
  const limiter = getLimiter(limiterName, rule);
  try {
    await limiter.consume(key);
    return null;
  } catch (error) {
    if (!(error instanceof RateLimiterRes)) {
      rateLimitLogger.error({ err: error, limiterName }, 'Rate limit store unavailable');
      return rateLimitUnavailable(request);
    }
    const retryAfter = Math.max(1, Math.ceil(error.msBeforeNext / 1000));
    return tooManyRequests(request, { ...rateLimitHeaders(rule, error), 'Retry-After': String(retryAfter) });
  }
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
  const policy: RateLimitPolicy = RATE_LIMIT_POLICIES[policyName];
  const guest = policy.guest;
  if (!guest) {
    return null;
  }
  return consumeLimit(request, `${policyName}:guest`, guest, getClientIpFromRequest(request));
}

/**
 * Signed-in counterpart of {@link enforceGuestRateLimit}. A policy without a
 * `user` rule deliberately grants authenticated callers no quota.
 */
export async function enforceUserRateLimit(
  request: Request,
  policyName: RateLimitPolicyName,
  userId: string,
): Promise<Response | null> {
  const rule = RATE_LIMIT_POLICIES[policyName].user;
  if (!rule) {
    return null;
  }
  return consumeLimit(request, `${policyName}:user`, rule, userId);
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
  userId: string | null,
): Promise<{ ok: true; lease: AiRateLimitLease } | { ok: false; response: Response }> {
  const policy = AI_RATE_LIMIT_POLICIES[policyName];
  const ip = getClientIpFromRequest(request);
  // Anonymous callers reading a public Work are budgeted per IP instead of per
  // user; both the user bucket and the concurrency slot key off `actorKey`.
  const actorKey = userId ?? `ip:${ip}`;
  const userLimiter = getLimiter(`${policyName}:user`, policy.user);
  const ipLimiter = getLimiter(`${policyName}:ip`, policy.ip);

  try {
    if (userId) {
      await userLimiter.consume(userId);
    }
    await ipLimiter.consume(ip);
  } catch (error) {
    if (!(error instanceof RateLimiterRes)) {
      rateLimitLogger.error({ err: error, policyName }, 'Rate limit store unavailable');
      return { ok: false, response: rateLimitUnavailable(request) };
    }
    const retryAfter = Math.max(1, Math.ceil(error.msBeforeNext / 1000));
    return {
      ok: false,
      response: tooManyRequests(request, { 'Retry-After': String(retryAfter) }),
    };
  }

  let acquired: boolean;
  try {
    acquired = await acquireConcurrentSlot(policyName, actorKey);
  } catch (error) {
    rateLimitLogger.error({ err: error, policyName }, 'AI concurrency store unavailable');
    return { ok: false, response: rateLimitUnavailable(request) };
  }
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
      await releaseConcurrentSlot(policyName, actorKey);
    } catch (error) {
      rateLimitLogger.warn({ err: error, policyName, actorKey }, 'Failed to release AI concurrency slot');
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
