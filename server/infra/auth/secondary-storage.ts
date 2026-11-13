import { getRedis } from '@/server/infra/cache';

/** Namespace Better Auth keys away from locks/queues on the shared Redis. */
const KEY_PREFIX = 'better-auth:';

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
 * Better Auth secondary storage backed by the shared Redis client.
 * Session rows stay in Postgres (`storeSessionInDatabase`); Redis absorbs
 * repeated get-session / middleware lookups across the Seoul→Mumbai hop.
 */
export const authSecondaryStorage = {
  async get(key: string): Promise<string | null> {
    return getRedis().get(storageKey(key));
  },

  async set(key: string, value: string, ttl?: number): Promise<void> {
    const redis = getRedis();
    const namespaced = storageKey(key);
    if (ttl && ttl > 0) {
      await redis.set(namespaced, value, 'EX', ttl);
      return;
    }
    await redis.set(namespaced, value);
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
