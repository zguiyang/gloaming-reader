import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acquireLock,
  acquireLockWithWait,
  isLockHeldByToken,
  releaseLock,
  renewLock,
  startLockRenewal,
} from '@/lib/redis-lock';

const redisState = vi.hoisted(() => {
  const values = new Map<string, string>();
  const expiries = new Map<string, number>();

  const set = vi.fn(async (key: string, token: string, _mode: string, ttl: number, nx: string) => {
    if (nx === 'NX' && values.has(key)) {
      return null;
    }
    values.set(key, token);
    expiries.set(key, ttl);
    return 'OK';
  });

  const get = vi.fn(async (key: string) => values.get(key) ?? null);

  const evalFn = vi.fn(async (script: string, _numKeys: number, key: string, token: string, ttl?: string) => {
    if (script.includes('EXPIRE')) {
      if (values.get(key) === token) {
        expiries.set(key, Number(ttl));
        return 1;
      }
      return 0;
    }

    if (values.get(key) === token) {
      values.delete(key);
      expiries.delete(key);
      return 1;
    }
    return 0;
  });

  return {
    values,
    expiries,
    set,
    get,
    eval: evalFn,
    clear() {
      values.clear();
      expiries.clear();
      set.mockClear();
      get.mockClear();
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
    vi.useRealTimers();
  });

  it('acquires with SET NX EX and releases only matching tokens', async () => {
    expect(await acquireLock('lock:a', 'token-1', 30)).toBe(true);
    expect(await acquireLock('lock:a', 'token-2', 30)).toBe(false);

    await releaseLock('lock:a', 'token-2');
    expect(redisState.values.get('lock:a')).toBe('token-1');

    await releaseLock('lock:a', 'token-1');
    expect(redisState.values.has('lock:a')).toBe(false);
  });

  it('renews only matching tokens and reports lease ownership', async () => {
    expect(await acquireLock('lock:c', 'token-1', 30)).toBe(true);
    expect(await renewLock('lock:c', 'token-1', 45)).toBe(true);
    expect(redisState.expiries.get('lock:c')).toBe(45);
    expect(await renewLock('lock:c', 'token-2', 45)).toBe(false);
    expect(await isLockHeldByToken('lock:c', 'token-1')).toBe(true);
    expect(await isLockHeldByToken('lock:c', 'token-2')).toBe(false);
  });

  it('waits until the lock becomes available', async () => {
    redisState.values.set('lock:b', 'holder');

    const waiter = acquireLockWithWait('lock:b', 'next', 30, { maxWaitMs: 200, retryIntervalMs: 20 });
    await new Promise((resolve) => setTimeout(resolve, 40));
    redisState.values.delete('lock:b');

    await expect(waiter).resolves.toBe(true);
    expect(redisState.values.get('lock:b')).toBe('next');
  });

  it('stops bounded renewal and reports lease loss when token no longer matches', async () => {
    vi.useFakeTimers();
    expect(await acquireLock('lock:d', 'token-1', 30)).toBe(true);

    const onLeaseLost = vi.fn();
    const renewal = startLockRenewal('lock:d', 'token-1', 30, {
      renewIntervalMs: 100,
      maxDurationMs: 500,
      onLeaseLost,
    });

    redisState.values.set('lock:d', 'other-token');
    await vi.advanceTimersByTimeAsync(100);

    expect(onLeaseLost).toHaveBeenCalledWith('renewal_failed');
    renewal.stop();
  });

  it('stops bounded renewal when maxDurationMs elapses', async () => {
    vi.useFakeTimers();
    expect(await acquireLock('lock:e', 'token-1', 30)).toBe(true);

    const onLeaseLost = vi.fn();
    const renewal = startLockRenewal('lock:e', 'token-1', 30, {
      renewIntervalMs: 100,
      maxDurationMs: 250,
      onLeaseLost,
    });

    await vi.advanceTimersByTimeAsync(300);

    expect(onLeaseLost).toHaveBeenCalledWith('max_duration');
    renewal.stop();
  });
});
