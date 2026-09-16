import { dbPing } from '@/db';
import { redisPing } from '@/lib/redis';

export const HEALTH_CHECK_TIMEOUT_MS = 1_000;

export type DependencyStatus = 'up' | 'down';

export type ReadinessResult = {
  ready: boolean;
  dependencies: {
    postgres: DependencyStatus;
    redis: DependencyStatus;
  };
};

async function probe(check: () => Promise<unknown>): Promise<DependencyStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      check(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('health check timed out')), HEALTH_CHECK_TIMEOUT_MS);
      }),
    ]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function checkReadiness(): Promise<ReadinessResult> {
  const [postgres, redis] = await Promise.all([probe(dbPing), probe(redisPing)]);
  return {
    ready: postgres === 'up' && redis === 'up',
    dependencies: { postgres, redis },
  };
}
