import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertExpireAuthorized, parseArgs, REDIS_NO_TTL_EXPIRE_ENV, scanPrefixNoTtl } from './redis-no-ttl-scan.ts';

describe('redis-no-ttl-scan CLI policy', () => {
  const originalEnv = process.env[REDIS_NO_TTL_EXPIRE_ENV];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[REDIS_NO_TTL_EXPIRE_ENV];
    } else {
      process.env[REDIS_NO_TTL_EXPIRE_ENV] = originalEnv;
    }
  });

  it('parses expire flags', () => {
    expect(parseArgs([])).toEqual({ expireBetterAuth: false, execute: false });
    expect(parseArgs(['--expire-better-auth', '--execute'])).toEqual({
      expireBetterAuth: true,
      execute: true,
    });
  });

  it('requires execute and env consent for expiry', () => {
    delete process.env[REDIS_NO_TTL_EXPIRE_ENV];
    expect(() => assertExpireAuthorized(parseArgs(['--expire-better-auth']))).toThrow(/execute/);
    expect(() => assertExpireAuthorized(parseArgs(['--expire-better-auth', '--execute']))).toThrow(
      /ALLOW_REDIS_NO_TTL_EXPIRE/,
    );
    process.env[REDIS_NO_TTL_EXPIRE_ENV] = '1';
    expect(() => assertExpireAuthorized(parseArgs(['--expire-better-auth', '--execute']))).not.toThrow();
  });

  it('reports keys with TTL=-1 only', async () => {
    const store = new Map<string, number>([
      ['gloaming:a', -1],
      ['gloaming:b', 30],
      ['gloaming:c', -1],
    ]);
    const redis = {
      scan: vi.fn(async () => ['0', [...store.keys()]] as [string, string[]]),
      ttl: vi.fn(async (key: string) => store.get(key) ?? -2),
    };

    const stats = await scanPrefixNoTtl(redis, 'gloaming:');
    expect(stats.scanned).toBe(3);
    expect(stats.noTtl).toBe(2);
    expect(stats.sampleKeys).toEqual(['gloaming:a', 'gloaming:c']);
  });
});
