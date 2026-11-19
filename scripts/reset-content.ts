/**
 * Dev-only content reset: wipes library/content rows, content Redis caches,
 * BullMQ queues, and every object in the configured S3-compatible bucket.
 *
 * Keeps: users/sessions/accounts/verification, LLM/TTS/dictionary admin config.
 *
 * Safety: refuses production NODE_ENV and non-local DATABASE_URL / REDIS_URL
 * hosts. Refuses S3 wipe unless the bucket name contains "development" or
 * "dev" (or RESET_CONTENT_ALLOW_BUCKET=1).
 *
 * Run from repo root (with workers stopped):
 *   pnpm exec tsx scripts/reset-content.ts
 */
import Redis from 'ioredis';

import {
  aiInvocationLog,
  contentAsset,
  conversation,
  conversationMessage,
  dictionaryEntry,
  partAudioSegment,
  readingDay,
  readingHeartbeat,
  readingPart,
  readingState,
  readingWork,
  ttsInvocationLog,
  uploadedObject,
  userLibraryItem,
  userTag,
  userWorkTag,
  userWorkTagSuppression,
} from '@/server/db';
import { commonEnv } from '@/server/infra/config/env-common';
import { db } from '@/server/infra/db';
import { deleteManyObjects, listObjects } from '@/server/infra/storage';

const CACHE_PATTERNS = [
  'gloaming:tts:*',
  'gloaming:bilingual:*',
  'gloaming:dictionary:*',
  'gloaming:upload:dedupe:*',
  'gloaming:ratelimit:*',
  'asset-management:*',
  'bull:gloaming:*',
  'bull:gloaming-asset-cleanup:*',
  'bull:gloaming-discovery-*',
] as const;

function assertDevTargets(): void {
  if (commonEnv.NODE_ENV === 'production') {
    throw new Error('Refusing reset-content in NODE_ENV=production');
  }

  const dbHost = new URL(commonEnv.DATABASE_URL).hostname;
  if (dbHost !== '127.0.0.1' && dbHost !== 'localhost') {
    throw new Error(`Refusing reset-content for non-local DATABASE_URL host: ${dbHost}`);
  }

  const redisHost = new URL(commonEnv.REDIS_URL).hostname;
  if (redisHost !== '127.0.0.1' && redisHost !== 'localhost') {
    throw new Error(`Refusing reset-content for non-local REDIS_URL host: ${redisHost}`);
  }
}

function assertDevBucket(bucket: string | undefined): void {
  if (!bucket) {
    return;
  }
  if (process.env.RESET_CONTENT_ALLOW_BUCKET === '1') {
    return;
  }
  const lower = bucket.toLowerCase();
  if (lower.includes('development') || lower.includes('-dev') || lower.endsWith('dev')) {
    return;
  }
  throw new Error(
    `Refusing S3 wipe for bucket "${bucket}". Name must look like a development bucket, or set RESET_CONTENT_ALLOW_BUCKET=1.`,
  );
}

function log(message: string): void {
  console.log(message);
}

async function clearTable(table: Parameters<typeof db.delete>[0], label: string): Promise<void> {
  await db.delete(table);
  log(`Cleared ${label}`);
}

async function flushRedisPatterns(redis: Redis): Promise<number> {
  let total = 0;
  for (const pattern of CACHE_PATTERNS) {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
      cursor = next;
      if (keys.length > 0) {
        await redis.del(...keys);
        total += keys.length;
      }
    } while (cursor !== '0');
  }
  console.log(`Deleted ${total} Redis keys`);
  return total;
}

async function flushObjectStorage(): Promise<void> {
  const bucket = commonEnv.S3_BUCKET;
  if (!bucket) {
    console.log('Object storage not configured — skipping');
    return;
  }
  assertDevBucket(bucket);
  let total = 0;
  let failed = 0;
  let token: string | undefined;
  do {
    const result = await listObjects(undefined, token);
    const keys = result.objects.map((object) => object.key);
    if (keys.length > 0) {
      const deletion = await deleteManyObjects(keys);
      total += deletion.deleted.length;
      failed += deletion.failed.length;
      console.log(`Object storage: deleted ${total} so far (${failed} failed)`);
    }
    token = result.nextCursor ?? undefined;
  } while (token);
  console.log(`Deleted ${total} objects from bucket ${bucket}${failed ? ` (${failed} failed)` : ''}`);
}
async function main(): Promise<void> {
  assertDevTargets();

  // Children first (FKs). Order matters for tables without ON DELETE CASCADE everywhere.
  await clearTable(conversationMessage, 'conversation messages');
  await clearTable(conversation, 'conversations');
  await clearTable(partAudioSegment, 'part audio segments');
  await clearTable(contentAsset, 'content assets');
  await clearTable(readingHeartbeat, 'reading heartbeats');
  await clearTable(readingState, 'reading states');
  await clearTable(userWorkTagSuppression, 'user work tag suppressions');
  await clearTable(userWorkTag, 'user work tags');
  await clearTable(userTag, 'user tags');
  await clearTable(userLibraryItem, 'library items');
  await clearTable(readingPart, 'reading parts');
  await clearTable(readingWork, 'reading works');
  await clearTable(uploadedObject, 'uploaded objects');
  await clearTable(readingDay, 'reading days');
  await clearTable(dictionaryEntry, 'dictionary cache entries');
  await clearTable(aiInvocationLog, 'AI invocation logs');
  await clearTable(ttsInvocationLog, 'TTS invocation logs');

  const redis = new Redis(commonEnv.REDIS_URL);
  try {
    await flushRedisPatterns(redis);
  } finally {
    redis.disconnect();
  }

  await flushObjectStorage();
  console.log('Content reset complete.');
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error('Content reset failed:', error);
  process.exit(1);
});
