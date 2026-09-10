/**
 * Redis TTS cache governance (SCAN-only, dry-run by default).
 *
 * Safety:
 * - Only allows explicit TTS key prefixes (`gloaming:tts:v1:` / `gloaming:tts:v2:`).
 * - Uses SCAN only — never KEYS, never FLUSHDB, never allkeys-* policy changes.
 * - Never touches BullMQ keys (`bull:*`).
 * - Default mode is dry-run report (count / TTL / size). Does not delete v1 or v2.
 *
 * Usage:
 *   pnpm --filter @gloaming/backend exec tsx scripts/tts-redis-governance.ts
 *   pnpm --filter @gloaming/backend exec tsx scripts/tts-redis-governance.ts --prefix=v2
 *   pnpm --filter @gloaming/backend exec tsx scripts/tts-redis-governance.ts --prefix=v1
 *   pnpm --filter @gloaming/backend exec tsx scripts/tts-redis-governance.ts --prefix=both
 */
import Redis from 'ioredis';

import { TTS_CACHE_KEY_PREFIX_V1, TTS_CACHE_KEY_PREFIX_V2 } from '@gloaming/shared/tts';

import { env } from '../src/lib/env.ts';

const ALLOWED_PREFIXES = {
  v1: TTS_CACHE_KEY_PREFIX_V1,
  v2: TTS_CACHE_KEY_PREFIX_V2,
} as const;

type PrefixChoice = keyof typeof ALLOWED_PREFIXES | 'both';

type CliOptions = {
  prefix: PrefixChoice;
};

type PrefixStats = {
  prefix: string;
  keyCount: number;
  totalBytes: number;
  ttlPresent: number;
  ttlMissing: number;
  ttlMinSeconds: number | null;
  ttlMaxSeconds: number | null;
  sampleKeys: string[];
};

function printUsage(): void {
  console.log(`Redis TTS governance (SCAN only, dry-run).

Options:
  --prefix=v1|v2|both   Which TTS prefix to scan (default: both)

Forbidden: KEYS, FLUSHDB, BullMQ key deletion, non-TTS prefixes.
This script never deletes keys (including legacy v1).
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { prefix: 'both' };
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
    if (arg === '--execute' || arg === '--delete' || arg === '--delete-v1') {
      throw new Error('Deletion is not supported by this SCAN-only script (default: never delete v1/v2)');
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function assertTtsPrefix(prefix: string): void {
  if (prefix.startsWith('bull:')) {
    throw new Error('Refusing BullMQ prefix');
  }
  if (prefix !== TTS_CACHE_KEY_PREFIX_V1 && prefix !== TTS_CACHE_KEY_PREFIX_V2) {
    throw new Error(`Refusing non-TTS prefix: ${prefix}`);
  }
}

function selectedPrefixes(choice: PrefixChoice): string[] {
  if (choice === 'both') {
    return [TTS_CACHE_KEY_PREFIX_V2, TTS_CACHE_KEY_PREFIX_V1];
  }
  return [ALLOWED_PREFIXES[choice]];
}

async function scanPrefix(redis: Redis, prefix: string): Promise<PrefixStats> {
  assertTtsPrefix(prefix);
  const match = `${prefix}*`;
  const stats: PrefixStats = {
    prefix,
    keyCount: 0,
    totalBytes: 0,
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

      const [ttl, value] = await Promise.all([redis.ttl(key), redis.get(key)]);
      if (ttl >= 0) {
        stats.ttlPresent += 1;
        stats.ttlMinSeconds = stats.ttlMinSeconds === null ? ttl : Math.min(stats.ttlMinSeconds, ttl);
        stats.ttlMaxSeconds = stats.ttlMaxSeconds === null ? ttl : Math.max(stats.ttlMaxSeconds, ttl);
      } else {
        stats.ttlMissing += 1;
      }
      if (value != null) {
        stats.totalBytes += Buffer.byteLength(value, 'utf8');
      }
    }
  } while (cursor !== '0');

  return stats;
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
  const prefixes = selectedPrefixes(options.prefix);
  const redis = new Redis(env.REDIS_URL);

  console.log('[DRY-RUN] Redis TTS governance (SCAN only; no deletes)');
  console.log(`[DRY-RUN] REDIS_URL host=${new URL(env.REDIS_URL).host}`);
  console.log(`[DRY-RUN] prefixes=${prefixes.join(', ')}`);

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
      console.log(`ttlPresent=${report.ttlPresent} ttlMissing=${report.ttlMissing}`);
      console.log(`ttlMinSeconds=${report.ttlMinSeconds ?? 'n/a'} ttlMaxSeconds=${report.ttlMaxSeconds ?? 'n/a'}`);
      if (report.sampleKeys.length > 0) {
        console.log(`sampleKeys=${JSON.stringify(report.sampleKeys)}`);
      }
    }
    console.log('---');
    console.log(
      '[DRY-RUN] complete (no keys deleted; v1 keys are not read by runtime — expire via TTL or separate governance)',
    );
  } finally {
    redis.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
