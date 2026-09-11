/**
 * Redis TTS cache governance (SCAN-only by default).
 *
 * Safety:
 * - Only allows explicit TTS key prefixes (`gloaming:tts:v1:` / `gloaming:tts:v2:`).
 * - Uses SCAN only — never KEYS, never FLUSHDB, never allkeys-* policy changes.
 * - Never touches BullMQ keys (`bull:*`).
 * - Default mode is dry-run report (count / TTL / payload length via STRLEN).
 * - Never GETs cache payloads into Node memory.
 * - v1 deletion requires ALLOW_TTS_REDIS_V1_CLEANUP=1, --delete-v1, and --execute.
 *
 * Usage:
 *   pnpm --filter @gloaming/backend exec tsx scripts/tts-redis-governance.ts
 *   pnpm --filter @gloaming/backend exec tsx scripts/tts-redis-governance.ts --prefix=v1
 *   ALLOW_TTS_REDIS_V1_CLEANUP=1 pnpm --filter @gloaming/backend exec tsx scripts/tts-redis-governance.ts --delete-v1 --execute
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import Redis from 'ioredis';

import { TTS_CACHE_KEY_PREFIX_V1, TTS_CACHE_KEY_PREFIX_V2 } from '@gloaming/shared/tts';

import { env } from '../src/lib/env.ts';

const ALLOWED_PREFIXES = {
  v1: TTS_CACHE_KEY_PREFIX_V1,
  v2: TTS_CACHE_KEY_PREFIX_V2,
} as const;

export const TTS_REDIS_V1_CLEANUP_ENV = 'ALLOW_TTS_REDIS_V1_CLEANUP';
const DELETE_BATCH_SIZE = 500;

type PrefixChoice = keyof typeof ALLOWED_PREFIXES | 'both';

type CliOptions = {
  prefix: PrefixChoice;
  deleteV1: boolean;
  execute: boolean;
};

export type PrefixStats = {
  prefix: string;
  keyCount: number;
  totalBytes: number;
  unmeasuredKeyCount: number;
  ttlPresent: number;
  ttlMissing: number;
  ttlMinSeconds: number | null;
  ttlMaxSeconds: number | null;
  sampleKeys: string[];
};

type RedisKeyInspector = Pick<Redis, 'scan' | 'ttl' | 'strlen' | 'type'>;

type DeleteV1Result = {
  deletedCount: number;
  remainingCount: number;
  failedKeys: string[];
};

function printUsage(): void {
  console.log(`Redis TTS governance (SCAN only by default).

Options:
  --prefix=v1|v2|both   Which TTS prefix to scan (default: both)
  --delete-v1           Target legacy v1 keys for deletion (requires --execute)
  --execute             Perform deletion when combined with --delete-v1

Forbidden: KEYS, FLUSHDB, BullMQ key deletion, non-TTS prefixes.
v2 keys are never deleted by this script.
`);
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { prefix: 'both', deleteV1: false, execute: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    if (arg.startsWith('--prefix=')) {
      const value = arg.slice('--prefix='.length).trim() as PrefixChoice;
      if (value !== 'v1' && value !== 'v2' && value !== 'both') {
        throw new Error(`Invalid --prefix=${value}; allowed: v1, v2, both`);
      }
      options.prefix = value;
      continue;
    }
    if (arg === '--delete-v1') {
      options.deleteV1 = true;
      continue;
    }
    if (arg === '--execute') {
      options.execute = true;
      continue;
    }
    if (arg === '--delete') {
      throw new Error('Use --delete-v1 with --execute for legacy v1 cleanup');
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function assertDeleteV1Authorized(options: CliOptions): void {
  if (!options.deleteV1) {
    return;
  }
  if (!options.execute) {
    throw new Error('Refusing --delete-v1 without --execute (default is dry-run report only)');
  }
  if (process.env[TTS_REDIS_V1_CLEANUP_ENV] !== '1') {
    throw new Error(`Refusing v1 deletion without ${TTS_REDIS_V1_CLEANUP_ENV}=1 (explicit operator consent)`);
  }
}

export function assertTtsPrefix(prefix: string): void {
  if (prefix.startsWith('bull:')) {
    throw new Error('Refusing BullMQ prefix');
  }
  if (prefix !== TTS_CACHE_KEY_PREFIX_V1 && prefix !== TTS_CACHE_KEY_PREFIX_V2) {
    throw new Error(`Refusing non-TTS prefix: ${prefix}`);
  }
}

export function selectedPrefixes(choice: PrefixChoice): string[] {
  if (choice === 'both') {
    return [TTS_CACHE_KEY_PREFIX_V2, TTS_CACHE_KEY_PREFIX_V1];
  }
  return [ALLOWED_PREFIXES[choice]];
}

function recordTtl(stats: PrefixStats, ttl: number): void {
  if (ttl >= 0) {
    stats.ttlPresent += 1;
    stats.ttlMinSeconds = stats.ttlMinSeconds === null ? ttl : Math.min(stats.ttlMinSeconds, ttl);
    stats.ttlMaxSeconds = stats.ttlMaxSeconds === null ? ttl : Math.max(stats.ttlMaxSeconds, ttl);
    return;
  }
  stats.ttlMissing += 1;
}

export async function inspectTtsCacheKey(
  redis: RedisKeyInspector,
  key: string,
): Promise<{ ttl: number; payloadBytes: number | null; unmeasured: boolean; keyType: string }> {
  const keyType = await redis.type(key);
  if (keyType === 'string') {
    try {
      const [ttl, length] = await Promise.all([redis.ttl(key), redis.strlen(key)]);
      return { ttl, payloadBytes: length, unmeasured: false, keyType };
    } catch {
      const ttl = await redis.ttl(key);
      return { ttl, payloadBytes: null, unmeasured: true, keyType };
    }
  }

  const ttl = await redis.ttl(key);
  return { ttl, payloadBytes: null, unmeasured: keyType !== 'none', keyType };
}

export async function scanPrefix(redis: RedisKeyInspector, prefix: string): Promise<PrefixStats> {
  assertTtsPrefix(prefix);
  const match = `${prefix}*`;
  const stats: PrefixStats = {
    prefix,
    keyCount: 0,
    totalBytes: 0,
    unmeasuredKeyCount: 0,
    ttlPresent: 0,
    ttlMissing: 0,
    ttlMinSeconds: null,
    ttlMaxSeconds: null,
    sampleKeys: [],
  };

  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', match, 'COUNT', 200);
    cursor = next;
    for (const key of keys) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      if (key.startsWith('bull:')) {
        throw new Error(`Unexpected BullMQ key matched TTS scan: ${key}`);
      }
      stats.keyCount += 1;
      if (stats.sampleKeys.length < 5) {
        stats.sampleKeys.push(key);
      }

      const inspection = await inspectTtsCacheKey(redis, key);
      recordTtl(stats, inspection.ttl);
      if (inspection.unmeasured || inspection.payloadBytes == null) {
        if (inspection.keyType !== 'none') {
          stats.unmeasuredKeyCount += 1;
        }
        continue;
      }
      stats.totalBytes += inspection.payloadBytes;
    }
  } while (cursor !== '0');

  return stats;
}

export async function collectKeysForPrefix(redis: Pick<Redis, 'scan'>, prefix: string): Promise<string[]> {
  assertTtsPrefix(prefix);
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
    cursor = next;
    for (const key of batch) {
      if (key.startsWith(prefix) && !key.startsWith('bull:')) {
        keys.push(key);
      }
    }
  } while (cursor !== '0');
  return keys;
}

export async function deleteV1Keys(redis: Redis): Promise<DeleteV1Result> {
  const prefix = TTS_CACHE_KEY_PREFIX_V1;
  const keys = await collectKeysForPrefix(redis, prefix);
  let deletedCount = 0;
  const failedKeys: string[] = [];

  for (let index = 0; index < keys.length; index += DELETE_BATCH_SIZE) {
    const batch = keys.slice(index, index + DELETE_BATCH_SIZE);
    const pipeline = redis.pipeline();
    for (const key of batch) {
      if (!key.startsWith(prefix)) {
        throw new Error(`Refusing to delete non-v1 key: ${key}`);
      }
      pipeline.unlink(key);
    }
    const results = await pipeline.exec();
    for (let batchIndex = 0; batchIndex < batch.length; batchIndex += 1) {
      const [error] = results?.[batchIndex] ?? [];
      if (error) {
        failedKeys.push(batch[batchIndex]!);
      } else {
        deletedCount += 1;
      }
    }
  }

  const remaining = await collectKeysForPrefix(redis, prefix);
  return {
    deletedCount,
    remainingCount: remaining.length,
    failedKeys,
  };
}

type RedisMemoryInfo = {
  usedMemory: string | null;
  usedMemoryDataset: string | null;
  evictedKeys: string | null;
  maxmemory: string | null;
  maxmemoryPolicy: string | null;
};

async function readRedisMemoryInfo(redis: Redis): Promise<RedisMemoryInfo> {
  const info = await redis.info('memory');
  const stats = await redis.info('stats');
  const combined = `${info}\n${stats}`;
  const readField = (field: string): string | null => {
    const match = combined.match(new RegExp(`^${field}:(.+)$`, 'm'));
    return match?.[1]?.trim() ?? null;
  };
  return {
    usedMemory: readField('used_memory_human'),
    usedMemoryDataset: readField('used_memory_dataset'),
    evictedKeys: readField('evicted_keys'),
    maxmemory: readField('maxmemory_human'),
    maxmemoryPolicy: readField('maxmemory_policy'),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  assertDeleteV1Authorized(options);
  const prefixes = options.deleteV1 ? [TTS_CACHE_KEY_PREFIX_V1] : selectedPrefixes(options.prefix);
  const redis = new Redis(env.REDIS_URL);

  const modeLabel = options.deleteV1 && options.execute ? 'EXECUTE' : 'DRY-RUN';
  console.log(`[${modeLabel}] Redis TTS governance (SCAN only; v2 never deleted)`);
  console.log(`[${modeLabel}] REDIS_URL host=${new URL(env.REDIS_URL).host}`);
  console.log(`[${modeLabel}] prefixes=${prefixes.join(', ')}`);

  try {
    const memory = await readRedisMemoryInfo(redis);
    console.log('---');
    console.log('redisMemoryReport');
    console.log(`used_memory=${memory.usedMemory ?? 'n/a'}`);
    console.log(`used_memory_dataset=${memory.usedMemoryDataset ?? 'n/a'}`);
    console.log(`evicted_keys=${memory.evictedKeys ?? 'n/a'}`);
    console.log(`maxmemory=${memory.maxmemory ?? 'n/a'}`);
    console.log(`maxmemory_policy=${memory.maxmemoryPolicy ?? 'n/a'}`);
    console.log(
      'capacityNote=Per-entry 2MiB cap and 7-day TTL do not guarantee total Redis capacity; no hard global cache ceiling is enforced when BullMQ shares this Redis.',
    );

    const reports: PrefixStats[] = [];
    for (const prefix of prefixes) {
      reports.push(await scanPrefix(redis, prefix));
    }

    for (const report of reports) {
      console.log('---');
      console.log(`prefix=${report.prefix}`);
      console.log(`keyCount=${report.keyCount}`);
      console.log(`totalCachePayloadBytes=${report.totalBytes}`);
      console.log(`unmeasuredKeyCount=${report.unmeasuredKeyCount}`);
      console.log(
        'payloadNote=totalCachePayloadBytes is STRLEN of string values only; unmeasured keys are non-string or measure-failed and are not treated as zero bytes.',
      );
      console.log(`ttlPresent=${report.ttlPresent} ttlMissing=${report.ttlMissing}`);
      console.log(`ttlMinSeconds=${report.ttlMinSeconds ?? 'n/a'} ttlMaxSeconds=${report.ttlMaxSeconds ?? 'n/a'}`);
      if (report.sampleKeys.length > 0) {
        console.log(`sampleKeys=${JSON.stringify(report.sampleKeys)}`);
      }
    }

    if (options.deleteV1 && options.execute) {
      const result = await deleteV1Keys(redis);
      console.log('---');
      console.log('v1DeleteResult');
      console.log(`deletedCount=${result.deletedCount}`);
      console.log(`remainingCount=${result.remainingCount}`);
      console.log(`failedCount=${result.failedKeys.length}`);
      if (result.failedKeys.length > 0) {
        console.log(`failedKeys=${JSON.stringify(result.failedKeys.slice(0, 10))}`);
        process.exitCode = 1;
      }
      if (result.remainingCount > 0) {
        process.exitCode = 1;
      }
    } else {
      console.log('---');
      console.log('[DRY-RUN] complete (no keys deleted; use --delete-v1 --execute with env consent to remove v1 keys)');
    }
  } finally {
    redis.disconnect();
  }
}

function isDirectCliRun(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectCliRun()) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
