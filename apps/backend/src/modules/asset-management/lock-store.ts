import { getRedis } from '@/lib/redis';

export type LockRenewalHandle = {
  stop: () => void;
  failed: () => boolean;
};

const RENEW_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export async function acquireLock(lockKey: string, token: string, ttlSeconds: number): Promise<boolean> {
  const locked = await getRedis().set(lockKey, token, 'EX', ttlSeconds, 'NX');
  return locked === 'OK';
}

export async function renewLock(lockKey: string, token: string, ttlSeconds: number): Promise<boolean> {
  const result = await getRedis().eval(RENEW_LOCK_SCRIPT, 1, lockKey, token, String(ttlSeconds));
  return result === 1;
}

export async function releaseLock(lockKey: string, token: string): Promise<void> {
  await getRedis().eval(RELEASE_LOCK_SCRIPT, 1, lockKey, token);
}

export function startLockRenewal(lockKey: string, token: string, ttlSeconds: number): LockRenewalHandle {
  let failed = false;
  let stopped = false;
  const intervalMs = Math.max(5_000, Math.floor((ttlSeconds * 1000) / 3));
  const timer = setInterval(() => {
    if (stopped || failed) return;
    void renewLock(lockKey, token, ttlSeconds)
      .then((renewed) => {
        if (!renewed && !stopped) {
          failed = true;
        }
      })
      .catch(() => {
        if (!stopped) {
          failed = true;
        }
      });
  }, intervalMs);
  timer.unref?.();
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    failed: () => failed,
  };
}
