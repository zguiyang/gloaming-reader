import { randomUUID } from 'node:crypto';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';

import { type Env, env, isS3ObjectStorageConfigured } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { createObjectStoreFromEnv, createS3ObjectStore } from '@/lib/oss';
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
    S3_ENDPOINT: 'https://s3.example.com',
    S3_REGION: 'auto',
    S3_BUCKET: 'bucket',
    S3_ACCESS_KEY_ID: 'key',
    S3_SECRET_ACCESS_KEY: 'secret',
    S3_FORCE_PATH_STYLE: false,
    ...overrides,
  };
}

describe('createObjectStoreFromEnv', () => {
  it('returns null when S3 credentials are incomplete', () => {
    expect(
      createObjectStoreFromEnv(
        baseEnv({
          S3_REGION: '',
          S3_BUCKET: '',
          S3_ACCESS_KEY_ID: '',
          S3_SECRET_ACCESS_KEY: '',
        }),
      ),
    ).toBeNull();
  });

  it('builds an S3 store when all S3 credentials are present', () => {
    const store = createObjectStoreFromEnv(baseEnv());
    expect(store).not.toBeNull();
  });
});

describe('createS3ObjectStore', () => {
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
      if (command instanceof ListObjectsV2Command) {
        return {
          Contents: [{ Key: 'a.mp3', Size: 3, ETag: 'etag' }],
          IsTruncated: false,
        };
      }
      throw new Error(`unexpected command ${String(command)}`);
    });

    const store = createS3ObjectStore({
      endpoint: 'https://s3.example.com',
      region: 'auto',
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

    await expect(store.list('audio/')).resolves.toEqual({
      objects: [{ key: 'a.mp3', size: 3, lastModified: null, etag: 'etag' }],
      nextCursor: null,
      hasMore: false,
    });
    expect(send.mock.calls[4]?.[0]).toBeInstanceOf(ListObjectsV2Command);
  });

  it('treats missing objects as null / false', async () => {
    const send = vi.fn(async () => {
      const error = new Error('missing');
      (error as { name?: string }).name = 'NoSuchKey';
      throw error;
    });
    const store = createS3ObjectStore({
      endpoint: 'https://s3.example.com',
      region: 'auto',
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
 * Live S3 is opt-in: Vitest setup loads developer `.env`, so S3_* may be present
 * even when `.env.test` omits them. Default `pnpm test` must not depend on DNS/network
 * to the provider. Set GLOAMING_S3_LIVE_TEST=1 to run the probe.
 */
const runS3LiveConnectivity = process.env.GLOAMING_S3_LIVE_TEST === '1' && isS3ObjectStorageConfigured();

describe.skipIf(!runS3LiveConnectivity)('S3 live connectivity', () => {
  it('puts, reads, and deletes a namespaced probe object', async () => {
    const store = createObjectStoreFromEnv(env);
    expect(store).not.toBeNull();
    if (!store) {
      return;
    }

    const key = `gloaming-dev-connectivity/${randomUUID()}.txt`;
    const body = Buffer.from('gloaming-s3-probe', 'utf8');
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
