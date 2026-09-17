import { Redis } from 'ioredis';

import { commonEnv } from '@/lib/env-common';
import { redisLogger } from '@/lib/logger';

let client: Redis | null = null;

// Health / cache client. BullMQ uses a separate connection in `lib/queue.ts`.
export function getRedis(): Redis {
  if (client) {
    return client;
  }

  redisLogger.info('Connecting to Redis...');
  client = new Redis(commonEnv.REDIS_URL);

  client.on('connect', () => {
    redisLogger.info('Connected to Redis');
  });

  client.on('error', (err) => {
    redisLogger.error({ err }, 'Redis connection error');
  });

  return client;
}

export async function redisPing(timeoutMs = 1_000): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getRedis().ping(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Redis ping timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
