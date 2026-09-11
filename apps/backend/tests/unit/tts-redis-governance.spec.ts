import { afterEach, describe, expect, it, vi } from 'vitest';

import { TTS_CACHE_KEY_PREFIX_V1, TTS_CACHE_KEY_PREFIX_V2 } from '@gloaming/shared/tts';

import {
  assertDeleteV1Authorized,
  assertTtsPrefix,
  collectKeysForPrefix,
  deleteV1Keys,
  inspectTtsCacheKey,
  parseArgs,
  scanPrefix,
  selectedPrefixes,
} from '../../scripts/tts-redis-governance.ts';

function createFakeRedis(store: Map<string, { type: string; value?: string; ttl: number }>) {
  const get = vi.fn(async () => {
    throw new Error('GET must not be used during TTS governance scan');
  });
  const keys = vi.fn(async () => {
    throw new Error('KEYS must not be used');
  });
  const strlen = vi.fn(async (key: string) => {
    const entry = store.get(key);
    if (!entry || entry.type !== 'string') {
      throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    }
    return Buffer.byteLength(entry.value ?? '', 'utf8');
  });
  const type = vi.fn(async (key: string) => store.get(key)?.type ?? 'none');
  const ttl = vi.fn(async (key: string) => store.get(key)?.ttl ?? -2);
  const scan = vi.fn(async (_cursor: string, _matchFlag: string, match: string, _countFlag: string, _count: number) => {
    const prefix = match.endsWith('*') ? match.slice(0, -1) : match;
    const found = [...store.keys()].filter((key) => key.startsWith(prefix));
    return ['0', found] as [string, string[]];
  });
  const unlink = vi.fn(async (key: string) => {
    store.delete(key);
    return 1;
  });
  const pipeline = vi.fn(() => {
    const queued: string[] = [];
    return {
      unlink(key: string) {
        queued.push(key);
        return this;
      },
      async exec() {
        return queued.map((key) => {
          store.delete(key);
          return [null, 1];
        });
      },
    };
  });

  return { get, keys, strlen, type, ttl, scan, unlink, pipeline };
}

describe('tts redis governance policy', () => {
  const originalEnv = process.env.ALLOW_TTS_REDIS_V1_CLEANUP;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ALLOW_TTS_REDIS_V1_CLEANUP;
    } else {
      process.env.ALLOW_TTS_REDIS_V1_CLEANUP = originalEnv;
    }
  });

  it('requires execute and env consent for v1 deletion', () => {
    delete process.env.ALLOW_TTS_REDIS_V1_CLEANUP;
    expect(() => assertDeleteV1Authorized(parseArgs(['--delete-v1']))).toThrow(/execute/);
    expect(() => assertDeleteV1Authorized(parseArgs(['--delete-v1', '--execute']))).toThrow(/ALLOW_TTS/);
    process.env.ALLOW_TTS_REDIS_V1_CLEANUP = '1';
    expect(() => assertDeleteV1Authorized(parseArgs(['--delete-v1', '--execute']))).not.toThrow();
  });

  it('only targets the v1 prefix for deletion mode', () => {
    expect(TTS_CACHE_KEY_PREFIX_V1).toBe('gloaming:tts:v1:');
    expect('gloaming:tts:v1:abc'.startsWith(TTS_CACHE_KEY_PREFIX_V1)).toBe(true);
    expect('gloaming:tts:v2:abc'.startsWith(TTS_CACHE_KEY_PREFIX_V1)).toBe(false);
    expect('bull:gloaming:queue'.startsWith(TTS_CACHE_KEY_PREFIX_V1)).toBe(false);
    expect(selectedPrefixes('v1')).toEqual([TTS_CACHE_KEY_PREFIX_V1]);
    expect(selectedPrefixes('both')).toEqual([TTS_CACHE_KEY_PREFIX_V2, TTS_CACHE_KEY_PREFIX_V1]);
    expect(() => assertTtsPrefix('bull:queue')).toThrow(/BullMQ/);
    expect(() => assertTtsPrefix('other:')).toThrow(/non-TTS/);
  });
});

describe('tts redis governance scan', () => {
  it('measures string payloads with strlen and never calls get', async () => {
    const store = new Map<string, { type: string; value?: string; ttl: number }>([
      ['gloaming:tts:v1:a', { type: 'string', value: 'aaaa', ttl: 60 }],
      ['gloaming:tts:v1:b', { type: 'string', value: 'bbbbbb', ttl: -1 }],
    ]);
    const redis = createFakeRedis(store);

    const stats = await scanPrefix(redis, TTS_CACHE_KEY_PREFIX_V1);
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.keys).not.toHaveBeenCalled();
    expect(redis.strlen).toHaveBeenCalled();
    expect(redis.ttl).toHaveBeenCalled();
    expect(stats.keyCount).toBe(2);
    expect(stats.totalBytes).toBe(10);
    expect(stats.ttlPresent).toBe(1);
    expect(stats.ttlMissing).toBe(1);
    expect(stats.unmeasuredKeyCount).toBe(0);
  });

  it('records non-string keys as unmeasured without fabricating bytes or deleting', async () => {
    const store = new Map<string, { type: string; value?: string; ttl: number }>([
      ['gloaming:tts:v1:hash', { type: 'hash', ttl: 30 }],
      ['gloaming:tts:v1:ok', { type: 'string', value: 'xy', ttl: 10 }],
    ]);
    const redis = createFakeRedis(store);

    const stats = await scanPrefix(redis, TTS_CACHE_KEY_PREFIX_V1);
    expect(redis.get).not.toHaveBeenCalled();
    expect(stats.totalBytes).toBe(2);
    expect(stats.unmeasuredKeyCount).toBe(1);
    expect(stats.keyCount).toBe(2);
    expect(store.has('gloaming:tts:v1:hash')).toBe(true);
  });

  it('treats strlen failures as unmeasured instead of inventing byte counts', async () => {
    const redis = createFakeRedis(new Map([['gloaming:tts:v1:broken', { type: 'string', value: 'payload', ttl: 5 }]]));
    redis.strlen.mockRejectedValueOnce(new Error('ERR strlen failed'));

    const inspection = await inspectTtsCacheKey(redis, 'gloaming:tts:v1:broken');
    expect(redis.get).not.toHaveBeenCalled();
    expect(inspection.payloadBytes).toBeNull();
    expect(inspection.unmeasured).toBe(true);
    expect(inspection.ttl).toBe(5);
  });

  it('does not delete v2 or bull keys and dry-run scan never unlinks', async () => {
    const store = new Map<string, { type: string; value?: string; ttl: number }>([
      ['gloaming:tts:v1:keep-or-delete', { type: 'string', value: 'v1', ttl: 20 }],
      ['gloaming:tts:v2:keep', { type: 'string', value: 'v2', ttl: 20 }],
      ['bull:gloaming:queue', { type: 'string', value: 'job', ttl: 20 }],
    ]);
    const redis = createFakeRedis(store);

    const v1Keys = await collectKeysForPrefix(redis, TTS_CACHE_KEY_PREFIX_V1);
    expect(v1Keys).toEqual(['gloaming:tts:v1:keep-or-delete']);
    await expect(scanPrefix(redis, TTS_CACHE_KEY_PREFIX_V2)).resolves.toMatchObject({
      prefix: TTS_CACHE_KEY_PREFIX_V2,
      keyCount: 1,
    });
    expect(redis.pipeline).not.toHaveBeenCalled();
    expect(redis.unlink).not.toHaveBeenCalled();
    expect(store.has('gloaming:tts:v2:keep')).toBe(true);
    expect(store.has('bull:gloaming:queue')).toBe(true);
  });

  it('deletes only v1 keys after env consent and leaves v2/bull untouched', async () => {
    process.env.ALLOW_TTS_REDIS_V1_CLEANUP = '1';
    const store = new Map<string, { type: string; value?: string; ttl: number }>([
      ['gloaming:tts:v1:one', { type: 'string', value: 'v1', ttl: 20 }],
      ['gloaming:tts:v2:two', { type: 'string', value: 'v2', ttl: 20 }],
      ['bull:gloaming:queue', { type: 'string', value: 'job', ttl: 20 }],
    ]);
    const redis = createFakeRedis(store);

    expect(() => assertDeleteV1Authorized({ prefix: 'both', deleteV1: true, execute: true })).not.toThrow();
    const result = await deleteV1Keys(redis as never);
    expect(result.deletedCount).toBe(1);
    expect(result.remainingCount).toBe(0);
    expect(store.has('gloaming:tts:v1:one')).toBe(false);
    expect(store.has('gloaming:tts:v2:two')).toBe(true);
    expect(store.has('bull:gloaming:queue')).toBe(true);
    expect(redis.get).not.toHaveBeenCalled();
  });
});
