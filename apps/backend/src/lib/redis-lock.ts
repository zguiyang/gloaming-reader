import { getRedis } from '@/lib/redis';

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const RENEW_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

/** Atomically acquire a lock with SET key token NX EX ttl. */
export async function acquireLock(lockKey: string, token: string, ttlSeconds: number): Promise<boolean> {
  const locked = await getRedis().set(lockKey, token, 'EX', ttlSeconds, 'NX');
  return locked === 'OK';
}

/** Atomically release a lock only when the token still matches. */
export async function releaseLock(lockKey: string, token: string): Promise<void> {
  await getRedis().eval(RELEASE_LOCK_SCRIPT, 1, lockKey, token);
}

/** Atomically extend a lock lease only when the token still matches. */
export async function renewLock(lockKey: string, token: string, ttlSeconds: number): Promise<boolean> {
  const renewed = await getRedis().eval(RENEW_LOCK_SCRIPT, 1, lockKey, token, String(ttlSeconds));
  return renewed === 1;
}

/** Returns true when the lock key is currently held by the given token. */
export async function isLockHeldByToken(lockKey: string, token: string): Promise<boolean> {
  const value = await getRedis().get(lockKey);
  return value === token;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Retry lock acquisition until success or maxWaitMs elapses.
 * Returns false when the wait budget is exhausted.
 */
export async function acquireLockWithWait(
  lockKey: string,
  token: string,
  ttlSeconds: number,
  options?: { maxWaitMs?: number; retryIntervalMs?: number },
): Promise<boolean> {
  const maxWaitMs = options?.maxWaitMs ?? 5_000;
  const retryIntervalMs = options?.retryIntervalMs ?? 50;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    if (await acquireLock(lockKey, token, ttlSeconds)) {
      return true;
    }
    await sleep(retryIntervalMs);
  }

  return false;
}

export type LockLeaseLostReason = 'renewal_failed' | 'max_duration';

export type LockRenewalHandle = {
  stop: () => void;
};

/**
 * Periodically renew a held lock until stopped, maxDurationMs elapses, or renewal fails.
 * Call stop() before compare-and-delete release.
 */
export function startLockRenewal(
  lockKey: string,
  token: string,
  ttlSeconds: number,
  options?: {
    renewIntervalMs?: number;
    maxDurationMs?: number;
    onLeaseLost?: (reason: LockLeaseLostReason) => void;
  },
): LockRenewalHandle {
  const renewIntervalMs = options?.renewIntervalMs ?? Math.max(Math.floor((ttlSeconds * 1000) / 3), 1_000);
  const maxDurationMs = options?.maxDurationMs ?? ttlSeconds * 1_000 * 4;
  const startedAt = Date.now();
  let stopped = false;

  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    clearInterval(timer);
  };

  const tick = async () => {
    if (stopped) {
      return;
    }

    if (Date.now() - startedAt >= maxDurationMs) {
      stop();
      options?.onLeaseLost?.('max_duration');
      return;
    }

    try {
      const renewed = await renewLock(lockKey, token, ttlSeconds);
      if (!renewed) {
        stop();
        options?.onLeaseLost?.('renewal_failed');
      }
    } catch {
      stop();
      options?.onLeaseLost?.('renewal_failed');
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, renewIntervalMs);
  timer.unref?.();

  return { stop };
}
