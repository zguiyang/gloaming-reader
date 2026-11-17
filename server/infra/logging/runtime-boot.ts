import { redisPing } from '@/server/infra/cache';
import { commonEnv, isS3ObjectStorageConfigured } from '@/server/infra/config/env-common';
import { dbPing } from '@/server/infra/db';
import { createLogger } from '@/server/infra/logging/logger';

export type RuntimeRole = 'app' | 'jobs';

function sanitizeDbHost(databaseUrl: string): string | undefined {
  try {
    return new URL(databaseUrl).host || undefined;
  } catch {
    return undefined;
  }
}

function sanitizeRedisHost(redisUrl: string): string | undefined {
  try {
    return new URL(redisUrl).host || undefined;
  } catch {
    return undefined;
  }
}

async function pingQueueRedis(): Promise<void> {
  // Dynamic import keeps BullMQ / job modules out of the Next app boot graph.
  const { getQueueConnection } = await import('@/server/infra/queue');
  const connection = getQueueConnection();
  const result = await connection.ping();
  if (result !== 'PONG') {
    throw new Error(`Unexpected queue Redis PING response: ${String(result)}`);
  }
}

/**
 * One-shot boot report: env already validated by import, then real DB/Redis probes.
 * Keeps startup logs short and ops-useful without dumping full configuration.
 */
export async function reportRuntimeBoot(role: RuntimeRole): Promise<void> {
  const log = createLogger('Boot', { service: role });
  const databaseHost = sanitizeDbHost(commonEnv.DATABASE_URL);
  const redisHost = sanitizeRedisHost(commonEnv.REDIS_URL);
  const objectStorageConfigured = isS3ObjectStorageConfigured(commonEnv);

  if (role === 'app') {
    // Ensures API-only vars (auth/mail) are validated before we claim app boot success.
    await import('@/server/infra/config/env');
  }

  log.info(
    {
      role,
      nodeEnv: commonEnv.NODE_ENV,
      logLevel: commonEnv.LOG_LEVEL,
      objectStorageConfigured,
      ...(objectStorageConfigured ? { s3Bucket: commonEnv.S3_BUCKET, s3Region: commonEnv.S3_REGION } : {}),
    },
    'Environment configuration validated',
  );

  await dbPing();
  log.info({ role, databaseHost }, 'PostgreSQL reachable');

  await redisPing();
  log.info({ role, redisHost }, 'Redis reachable');

  if (role === 'jobs') {
    await pingQueueRedis();
    log.info({ role, redisHost }, 'Queue Redis reachable');
  }

  log.info({ role }, role === 'jobs' ? 'Jobs runtime ready' : 'App runtime ready');
}
