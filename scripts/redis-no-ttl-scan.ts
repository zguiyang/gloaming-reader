/**
 * Scan known application Redis prefixes for keys with no TTL (TTL=-1).
 *
 * Safety:
 * - SCAN only — never KEYS, FLUSHDB, or BullMQ (`bull:*`) prefixes.
 * - Default is dry-run report.
 * - Optional expiry is limited to `better-auth:*` and requires env consent + `--execute`.
 *
 * Usage:
 *   pnpm exec tsx scripts/redis-no-ttl-scan.ts
 *   ALLOW_REDIS_NO_TTL_EXPIRE=1 pnpm exec tsx scripts/redis-no-ttl-scan.ts --expire-better-auth --execute
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type Redis from 'ioredis';

export const REDIS_NO_TTL_EXPIRE_ENV = 'ALLOW_REDIS_NO_TTL_EXPIRE';

/** Application prefixes that must not hold permanent business keys. */
export const SCAN_PREFIXES = ['better-auth:', 'gloaming:', 'asset-management:'] as const;

/**
 * Keep in sync with `AUTH_SECONDARY_STORAGE_DEFAULT_TTL_SECONDS`
 * (`server/infra/auth/secondary-storage.ts`).
 */
export const BETTER_AUTH_NO_TTL_EXPIRE_SECONDS = 7 * 24 * 60 * 60;

const EXPIRE_BATCH_SIZE = 200;

export type CliOptions = {
  expireBetterAuth: boolean;
  execute: boolean;
};

export type PrefixNoTtlStats = {
  prefix: string;
  scanned: number;
  noTtl: number;
  sampleKeys: string[];
};

function printUsage(): void {
  console.log(`Redis no-TTL scan (SCAN only).

Options:
  --expire-better-auth   Expire better-auth:* keys that have TTL=-1 (requires --execute)
  --execute              Perform expiry when combined with --expire-better-auth

Env:
  ${REDIS_NO_TTL_EXPIRE_ENV}=1   Required consent for --expire-better-auth --execute

Forbidden: KEYS, FLUSHDB, bull:* mutation.
`);
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { expireBetterAuth: false, execute: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    if (arg === '--expire-better-auth') {
      options.expireBetterAuth = true;
      continue;
    }
    if (arg === '--execute') {
      options.execute = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function assertExpireAuthorized(options: CliOptions): void {
  if (!options.expireBetterAuth) {
    return;
  }
  if (!options.execute) {
    throw new Error('--expire-better-auth requires --execute (dry-run reports only by default)');
  }
  if (process.env[REDIS_NO_TTL_EXPIRE_ENV] !== '1') {
    throw new Error(`Set ${REDIS_NO_TTL_EXPIRE_ENV}=1 to authorize better-auth no-TTL expiry`);
  }
}

export async function scanPrefixNoTtl(redis: Pick<Redis, 'scan' | 'ttl'>, prefix: string): Promise<PrefixNoTtlStats> {
  let cursor = '0';
  let scanned = 0;
  let noTtl = 0;
  const sampleKeys: string[] = [];

  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
    cursor = next;
    for (const key of keys) {
      scanned += 1;
      const ttl = await redis.ttl(key);
      if (ttl === -1) {
        noTtl += 1;
        if (sampleKeys.length < 20) {
          sampleKeys.push(key);
        }
      }
    }
  } while (cursor !== '0');

  return { prefix, scanned, noTtl, sampleKeys };
}

export async function expireBetterAuthNoTtlKeys(
  redis: Pick<Redis, 'scan' | 'ttl' | 'expire'>,
  ttlSeconds: number,
): Promise<{ expired: number; failed: string[] }> {
  let cursor = '0';
  let expired = 0;
  const failed: string[] = [];
  const batch: string[] = [];

  const flush = async () => {
    for (const key of batch) {
      try {
        const ok = await redis.expire(key, ttlSeconds);
        if (ok === 1) {
          expired += 1;
        }
      } catch {
        failed.push(key);
      }
    }
    batch.length = 0;
  };

  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'better-auth:*', 'COUNT', 200);
    cursor = next;
    for (const key of keys) {
      const ttl = await redis.ttl(key);
      if (ttl !== -1) {
        continue;
      }
      batch.push(key);
      if (batch.length >= EXPIRE_BATCH_SIZE) {
        await flush();
      }
    }
  } while (cursor !== '0');

  if (batch.length > 0) {
    await flush();
  }

  return { expired, failed };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  assertExpireAuthorized(options);

  const { default: RedisClient } = await import('ioredis');
  const { commonEnv } = await import('@/server/infra/config/env-common');

  const redis = new RedisClient(commonEnv.REDIS_URL);
  try {
    const reports: PrefixNoTtlStats[] = [];
    for (const prefix of SCAN_PREFIXES) {
      const stats = await scanPrefixNoTtl(redis, prefix);
      reports.push(stats);
      console.log(
        JSON.stringify(
          {
            prefix: stats.prefix,
            scanned: stats.scanned,
            noTtl: stats.noTtl,
            sampleKeys: stats.sampleKeys,
          },
          null,
          2,
        ),
      );
    }

    const totalNoTtl = reports.reduce((sum, row) => sum + row.noTtl, 0);
    console.log(`Total no-TTL keys across scanned prefixes: ${totalNoTtl}`);

    if (options.expireBetterAuth && options.execute) {
      const result = await expireBetterAuthNoTtlKeys(redis, BETTER_AUTH_NO_TTL_EXPIRE_SECONDS);
      console.log(
        JSON.stringify(
          {
            action: 'expire-better-auth',
            ttlSeconds: BETTER_AUTH_NO_TTL_EXPIRE_SECONDS,
            expired: result.expired,
            failed: result.failed,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    redis.disconnect();
  }
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
