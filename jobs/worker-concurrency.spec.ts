import { describe, expect, it, vi } from 'vitest';

const workerOpts = vi.hoisted(
  () =>
    [] as Array<{
      concurrency?: number;
    }>,
);

const testCommonEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgresql://localhost:5432/gloaming_test',
  REDIS_URL: 'redis://127.0.0.1:6379',
  LLM_CONFIG_ENCRYPTION_KEY: 'test-encryption-key',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'test',
  S3_ACCESS_KEY_ID: 'test',
  S3_SECRET_ACCESS_KEY: 'test',
  S3_FORCE_PATH_STYLE: false,
} as const;

vi.mock('@/server/infra/db', () => ({ db: {} }));
vi.mock('@/server/infra/config/env-common', () => ({
  commonEnv: testCommonEnv,
  isS3ObjectStorageConfigured: () => true,
  loadCommonEnvConfig: () => testCommonEnv,
  parseCommonEnvConfig: () => testCommonEnv,
}));
vi.mock('@/server/infra/logging/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  queueLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  workerLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  reportRuntimeBoot: vi.fn(),
}));
vi.mock('@/server/application/commands/recover-stalled-content-parses', () => ({
  recoverStalledContentParses: vi.fn(),
}));

vi.mock('ioredis', () => ({
  Redis: class {
    on() {
      return this;
    }
    async quit() {
      return 'OK';
    }
  },
}));

vi.mock('bullmq', () => ({
  Queue: class {
    async close() {}
  },
  Worker: class {
    constructor(
      _queueName: string,
      _processor: unknown,
      opts: {
        concurrency?: number;
      },
    ) {
      workerOpts.push(opts);
    }
    on() {
      return this;
    }
    async close() {}
  },
}));

const { CLEANUP_WORKER_CONCURRENCY, createWorkers } = await import('@/jobs/worker');

describe('worker concurrency', () => {
  it('processes asset cleanup jobs sequentially', () => {
    expect(CLEANUP_WORKER_CONCURRENCY).toBe(1);
    workerOpts.length = 0;
    createWorkers();
    const cleanupOpts = workerOpts.find((opts) => opts.concurrency === CLEANUP_WORKER_CONCURRENCY);
    expect(cleanupOpts).toMatchObject({ concurrency: CLEANUP_WORKER_CONCURRENCY });
  });
});
