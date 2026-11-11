import { getRedis } from '@/infra/cache';

/** Namespace Better Auth keys away from locks/queues on the shared Redis. */
const KEY_PREFIX = 'better-auth:';

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
};
