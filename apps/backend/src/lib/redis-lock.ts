import { getRedis } from '@/lib/redis';

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
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
