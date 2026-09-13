import { beforeEach, describe, expect, it, vi } from 'vitest';

import { acquireLock, acquireLockWithWait, releaseLock } from '@/lib/redis-lock';

const redisState = vi.hoisted(() => {
  const values = new Map<string, string>();
  const set = vi.fn(async (key: string, token: string, _mode: string, _ttl: number, nx: string) => {
    if (nx === 'NX' && values.has(key)) {
      return null;
    }
    values.set(key, token);
    return 'OK';
  });
  const evalFn = vi.fn(async (_script: string, _numKeys: number, key: string, token: string) => {
    if (values.get(key) === token) {
      values.delete(key);
      return 1;
    }
    return 0;
  });

  return {
    values,
    set,
    eval: evalFn,
    clear() {
      values.clear();
      set.mockClear();
      evalFn.mockClear();
    },
  };
});

vi.mock('@/lib/redis', () => ({
  getRedis: () => redisState,
}));

describe('redis-lock', () => {
  beforeEach(() => {
    redisState.clear();
  });

  it('acquires with SET NX EX and releases only matching tokens', async () => {
    expect(await acquireLock('lock:a', 'token-1', 30)).toBe(true);
    expect(await acquireLock('lock:a', 'token-2', 30)).toBe(false);

    await releaseLock('lock:a', 'token-2');
    expect(redisState.values.get('lock:a')).toBe('token-1');

    await releaseLock('lock:a', 'token-1');
    expect(redisState.values.has('lock:a')).toBe(false);
  });

  it('waits until the lock becomes available', async () => {
    redisState.values.set('lock:b', 'holder');

    const waiter = acquireLockWithWait('lock:b', 'next', 30, { maxWaitMs: 200, retryIntervalMs: 20 });
    await new Promise((resolve) => setTimeout(resolve, 40));
    redisState.values.delete('lock:b');

    await expect(waiter).resolves.toBe(true);
    expect(redisState.values.get('lock:b')).toBe('next');
  });
});
