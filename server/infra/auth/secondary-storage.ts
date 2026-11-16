import { getRedis } from '@/server/infra/cache';
import { authLogger } from '@/server/infra/logging/logger';

/** Namespace Better Auth keys away from locks/queues on the shared Redis. */
const KEY_PREFIX = 'better-auth:';

/**
 * Better Auth default session lifetime (7d). Secondary-storage writes never
 * exceed this, and omitted/invalid TTLs fall back to it — never permanent keys.
 */
export const AUTH_SECONDARY_STORAGE_MAX_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Applied when Better Auth omits ttl or passes a non-positive value. */
export const AUTH_SECONDARY_STORAGE_DEFAULT_TTL_SECONDS = AUTH_SECONDARY_STORAGE_MAX_TTL_SECONDS;

/**
 * Fixed-window counter: increment, and pin the TTL only when the key is new so
 * the window never slides or extends.
 */
const RATE_LIMIT_WINDOW_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
`;

function storageKey(key: string): string {
  return `${KEY_PREFIX}${key}`;
}

/**
 * Resolve a positive Redis TTL for Better Auth secondary storage.
 * Missing or non-positive values use the default; values above the max are clamped.
 */
export function resolveAuthSecondaryStorageTtl(ttl?: number): number {
  const raw = typeof ttl === 'number' && Number.isFinite(ttl) ? Math.trunc(ttl) : Number.NaN;
  if (!Number.isFinite(raw) || raw <= 0) {
    return AUTH_SECONDARY_STORAGE_DEFAULT_TTL_SECONDS;
  }
  return Math.min(raw, AUTH_SECONDARY_STORAGE_MAX_TTL_SECONDS);
}

/**
 * Better Auth secondary storage backed by the shared Redis client.
 * Session rows stay in Postgres (`storeSessionInDatabase`); Redis absorbs
 * repeated get-session / middleware lookups across the Seoul→Mumbai hop.
 */
export const authSecondaryStorage = {
  async get(key: string): Promise<string | null> {
    return getRedis().get(storageKey(key));
  },

  async set(key: string, value: string, ttl?: number): Promise<void> {
    const resolvedTtl = resolveAuthSecondaryStorageTtl(ttl);
    const hasPositiveTtl = typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0;
    if (!hasPositiveTtl) {
      authLogger.warn(
        { key: storageKey(key), ttl, resolvedTtl },
        'Better Auth secondaryStorage.set omitted a positive TTL; applying default expiry',
      );
    } else if (resolvedTtl < Math.trunc(ttl)) {
      authLogger.warn(
        { key: storageKey(key), ttl, resolvedTtl },
        'Better Auth secondaryStorage.set TTL exceeded max; clamping',
      );
    }
    await getRedis().set(storageKey(key), value, 'EX', resolvedTtl);
  },

  async delete(key: string): Promise<void> {
    await getRedis().del(storageKey(key));
  },

  async getAndDelete(key: string): Promise<string | null> {
    const redis = getRedis();
    const namespaced = storageKey(key);
    const value = await redis.get(namespaced);
    if (value !== null) {
      await redis.del(namespaced);
    }
    return value;
  },

  /**
   * Better Auth rate-limit contract: the second argument is the window TTL in
   * seconds, not an increment. The counter must start at 1 and carry a fixed
   * expiry set on creation — `INCRBY key ttl` would jump the counter by the
   * whole window on the first request (tripping `max` immediately) and would
   * never expire the key, permanently locking the caller out.
   */
  async increment(key: string, ttlSeconds = 1): Promise<number> {
    const result = await getRedis().eval(
      RATE_LIMIT_WINDOW_SCRIPT,
      1,
      storageKey(key),
      String(Math.max(1, Math.trunc(ttlSeconds))),
    );
    return Number(result);
  },
};
