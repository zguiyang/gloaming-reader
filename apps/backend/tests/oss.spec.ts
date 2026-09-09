import { randomUUID } from 'node:crypto';

import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';

import { type Env, env, isR2ObjectStorageConfigured } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { createObjectStoreFromEnv, createR2ObjectStore } from '@/lib/oss';
import { putObject, resetObjectStoreCache, setObjectStoreForTests } from '@/modules/oss';

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: 'test',
    PORT: 3333,
    HOST: 'localhost',
    LOG_LEVEL: 'info',
    FRONTEND_URL: 'http://localhost:3000',
    BETTER_AUTH_SECRET: 'test-secret-at-least-16',
    DATABASE_URL: 'postgresql://localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    RESEND_API_KEY: 're_test_key',
    MAIL_FROM_ADDRESS: 'noreply@example.com',
    MAIL_FROM_NAME: 'Gloaming',
    LLM_CONFIG_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    OSS_DRIVER: 'r2',
    R2_ACCOUNT_ID: 'acct',
    R2_BUCKET: 'bucket',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    ...overrides,
  };
}

describe('createObjectStoreFromEnv', () => {
  it('returns null when R2 credentials are incomplete', () => {
    expect(
      createObjectStoreFromEnv(
        baseEnv({
          R2_ACCOUNT_ID: '',
          R2_BUCKET: '',
          R2_ACCESS_KEY_ID: '',
          R2_SECRET_ACCESS_KEY: '',
        }),
      ),
    ).toBeNull();
  });

  it('builds an R2 store when all R2 credentials are present', () => {
    const store = createObjectStoreFromEnv(baseEnv());
    expect(store).not.toBeNull();
  });
});

describe('createR2ObjectStore', () => {
  it('maps put/get/exists/delete to S3 commands', async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof PutObjectCommand) {
        return {};
      }
      if (command instanceof GetObjectCommand) {
        return {
          Body: {
            transformToByteArray: async () => new Uint8Array([1, 2, 3]),
          },
          ContentType: 'audio/mpeg',
        };
      }
      if (command instanceof HeadObjectCommand) {
        return {};
      }
      if (command instanceof DeleteObjectCommand) {
        return {};
      }
      throw new Error(`unexpected command ${String(command)}`);
    });

    const store = createR2ObjectStore({
      accountId: 'acct',
      bucket: 'my-bucket',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      client: { send } as never,
    });

    await store.put({ key: 'a.mp3', body: Buffer.from('abc'), contentType: 'audio/mpeg' });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(PutObjectCommand);

    const got = await store.get('a.mp3');
    expect(got).toEqual({ body: Buffer.from([1, 2, 3]), contentType: 'audio/mpeg' });
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(GetObjectCommand);

    await expect(store.exists('a.mp3')).resolves.toBe(true);
    expect(send.mock.calls[2]?.[0]).toBeInstanceOf(HeadObjectCommand);

    await store.delete('a.mp3');
    expect(send.mock.calls[3]?.[0]).toBeInstanceOf(DeleteObjectCommand);
  });

  it('treats missing objects as null / false', async () => {
    const send = vi.fn(async () => {
      const error = new Error('missing');
      (error as { name?: string }).name = 'NoSuchKey';
      throw error;
    });
    const store = createR2ObjectStore({
      accountId: 'acct',
      bucket: 'my-bucket',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      client: { send } as never,
    });
    await expect(store.get('missing.mp3')).resolves.toBeNull();
    await expect(store.exists('missing.mp3')).resolves.toBe(false);
  });
});

describe('oss facade', () => {
  it('Fail Fast with 503 when unconfigured', async () => {
    resetObjectStoreCache();
    setObjectStoreForTests(null);
    await expect(putObject({ key: 'x', body: Buffer.from('x'), contentType: 'text/plain' })).rejects.toSatisfy(
      (error: unknown) => error instanceof AppError && error.statusCode === 503,
    );
    resetObjectStoreCache();
  });
});

/**
 * Live R2 is opt-in: Vitest setup loads developer `.env`, so R2_* may be present
 * even when `.env.test` omits them. Default `pnpm test` must not depend on DNS/network
 * to Cloudflare. Set GLOAMING_R2_LIVE_TEST=1 to run the probe.
 */
const runR2LiveConnectivity = process.env.GLOAMING_R2_LIVE_TEST === '1' && isR2ObjectStorageConfigured();

describe.skipIf(!runR2LiveConnectivity)('R2 live connectivity', () => {
  it('puts, reads, and deletes a namespaced probe object', async () => {
    const store = createObjectStoreFromEnv(env);
    expect(store).not.toBeNull();
    if (!store) {
      return;
    }

    const key = `gloaming-dev-connectivity/${randomUUID()}.txt`;
    const body = Buffer.from('gloaming-r2-probe', 'utf8');
    try {
      await store.put({ key, body, contentType: 'text/plain' });
      await expect(store.exists(key)).resolves.toBe(true);
      const got = await store.get(key);
      expect(got).not.toBeNull();
      expect(got?.contentType).toBe('text/plain');
      expect(got?.body.equals(body)).toBe(true);
    } finally {
      await store.delete(key);
      await expect(store.exists(key)).resolves.toBe(false);
    }
  });
});
