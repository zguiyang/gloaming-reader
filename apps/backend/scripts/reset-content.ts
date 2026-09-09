/**
 * Dev-only content reset: wipes all content rows (works, parts, states, assets,
 * conversations, uploads, reading days), content-derived Redis caches
 * (TTS audio, bilingual translation), the BullMQ job queue, and object-storage
 * files (S3-compatible).
 *
 * Keeps: users/sessions/accounts, LLM config, TTS config.
 * Run: pnpm --filter @gloaming/backend reset:content
 */
import Redis from 'ioredis';

import {
  contentAsset as contentAssetTable,
  conversation as conversationTable,
  conversationMessage as conversationMessageTable,
  readingDay as readingDayTable,
  readingPart as readingPartTable,
  readingState as readingStateTable,
  readingWork as readingWorkTable,
  uploadedObject as uploadedObjectTable,
} from '@gloaming/db';

import { db } from '../src/db/index.ts';
import { env } from '../src/lib/env.ts';
import { deleteObject, listObjects } from '../src/modules/oss/index.ts';

const CACHE_PATTERNS = ['gloaming:tts:v1:*', 'gloaming:bilingual:v2:*'] as const;

async function deleteAll(table: Parameters<typeof db.delete>[0], label: string): Promise<number> {
  const rows = await db.delete(table).returning({ id: table.id });
  console.log(`Deleted ${rows.length} ${label}`);
  return rows.length;
}

async function flushCachePatterns(redis: Redis): Promise<number> {
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
  console.log(`Deleted ${total} Redis cache keys`);
  return total;
}

/** Wipe the BullMQ queue so stale jobs (old products, deleted works) never run again. */
async function flushJobQueue(redis: Redis): Promise<void> {
  let cursor = '0';
  let total = 0;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'bull:gloaming:*', 'COUNT', 500);
    cursor = next;
    if (keys.length > 0) {
      await redis.del(...keys);
      total += keys.length;
    }
  } while (cursor !== '0');
  console.log(`Deleted ${total} BullMQ queue keys`);
}

/** Wipe every object in the configured S3-compatible bucket (dev bucket — all content is throwaway). */
async function flushObjectStorage(): Promise<void> {
  if (!env.S3_BUCKET) {
    console.log('S3-compatible object storage not configured — skipping object storage flush');
    return;
  }
  let total = 0;
  let token: string | undefined;
  do {
    const result = await listObjects(undefined, token);
    for (const object of result.objects) {
      await deleteObject(object.key);
      total += 1;
    }
    token = result.nextCursor ?? undefined;
  } while (token);
  console.log(`Deleted ${total} S3-compatible objects`);
}

async function main() {
  await deleteAll(conversationMessageTable, 'conversation messages');
  await deleteAll(conversationTable, 'conversations');
  await deleteAll(contentAssetTable, 'content assets');
  await deleteAll(readingStateTable, 'reading states');
  await deleteAll(readingPartTable, 'reading parts');
  await deleteAll(uploadedObjectTable, 'uploaded objects');
  await deleteAll(readingDayTable, 'reading days');
  await deleteAll(readingWorkTable, 'reading works');

  const redis = new Redis(env.REDIS_URL);
  try {
    await flushCachePatterns(redis);
    await flushJobQueue(redis);
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
