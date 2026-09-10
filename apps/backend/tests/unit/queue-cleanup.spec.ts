import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JOB_ASSET_CLEANUP } from '@/jobs/asset-cleanup';
import { JOB_PING } from '@/jobs/ping';

const queueAddCalls: Array<{ queueName: string; name: string }> = [];
const queueCloseCalls: string[] = [];
const workerConstructors: Array<{ name: string; opts: Record<string, unknown> }> = [];
const workerProcessors = new Map<string, (job: { name: string; data: unknown }) => Promise<unknown>>();

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

vi.mock('bullmq', () => {
  class MockQueue {
    name: string;
    constructor(name: string) {
      this.name = name;
    }
    async add(name: string) {
      queueAddCalls.push({ queueName: this.name, name });
      return { id: `${this.name}:${name}` };
    }
    async close() {
      queueCloseCalls.push(this.name);
    }
  }

  class MockWorker {
    constructor(
      name: string,
      processor: (job: { name: string; data: unknown }) => Promise<unknown>,
      opts: Record<string, unknown> = {},
    ) {
      workerConstructors.push({ name, opts });
      workerProcessors.set(name, processor);
    }
    on() {
      return this;
    }
    async close() {}
  }

  return { Queue: MockQueue, Worker: MockWorker };
});

const processAssetCleanup = vi.fn().mockResolvedValue({ ok: true });

vi.mock('@/jobs/asset-cleanup', () => ({
  JOB_ASSET_CLEANUP: 'asset-cleanup',
  processAssetCleanup: (...args: unknown[]) => processAssetCleanup(...args),
}));

vi.mock('@/jobs/content-parse', () => ({
  JOB_CONTENT_PARSE: 'content-parse',
  processContentParse: vi.fn(),
}));

vi.mock('@/jobs/metadata-enrich', () => ({
  JOB_METADATA_ENRICH: 'metadata-enrich',
  processMetadataEnrich: vi.fn(),
}));

vi.mock('@/jobs/part-audio-generate', () => ({
  JOB_PART_AUDIO_GENERATE: 'part-audio-generate',
  processPartAudioGenerate: vi.fn(),
}));

vi.mock('@/jobs/work-metadata-fill', () => ({
  JOB_METADATA_FILL: 'metadata-fill',
  processWorkMetadataFill: vi.fn(),
}));

const { CLEANUP_QUEUE_NAME, closeQueue, enqueue, enqueueCleanup, QUEUE_NAME } = await import('@/lib/queue');
const { CLEANUP_WORKER_CONCURRENCY, createWorkers, processCleanupJob, processJob } = await import('@/worker');

describe('cleanup queue isolation', () => {
  beforeEach(() => {
    queueAddCalls.length = 0;
    queueCloseCalls.length = 0;
    workerConstructors.length = 0;
    workerProcessors.clear();
    processAssetCleanup.mockClear();
  });

  afterEach(async () => {
    await closeQueue();
  });

  it('enqueues cleanup jobs on CLEANUP_QUEUE_NAME, not QUEUE_NAME', async () => {
    await enqueueCleanup(JOB_ASSET_CLEANUP, { jobId: 'job_1', scanId: 'scan_1' });
    await enqueue(JOB_PING, { requestedAt: '2026-09-10T00:00:00.000Z' });

    expect(queueAddCalls).toEqual([
      { queueName: CLEANUP_QUEUE_NAME, name: JOB_ASSET_CLEANUP },
      { queueName: QUEUE_NAME, name: JOB_PING },
    ]);
    expect(CLEANUP_QUEUE_NAME).toBe('gloaming-asset-cleanup');
    expect(CLEANUP_QUEUE_NAME).not.toBe(QUEUE_NAME);
  });

  it('closes both queues', async () => {
    await enqueueCleanup(JOB_ASSET_CLEANUP, { jobId: 'job_1', scanId: 'scan_1' });
    await enqueue(JOB_PING, { requestedAt: '2026-09-10T00:00:00.000Z' });
    await closeQueue();

    expect(queueCloseCalls).toEqual([CLEANUP_QUEUE_NAME, QUEUE_NAME]);
  });

  it('starts a dedicated cleanup worker with concurrency 1', () => {
    const workers = createWorkers();

    expect(workerConstructors).toHaveLength(2);
    expect(workerConstructors.map((entry) => entry.name)).toEqual([QUEUE_NAME, CLEANUP_QUEUE_NAME]);
    expect(workerConstructors[0]?.opts.concurrency).toBeUndefined();
    expect(workerConstructors[1]?.opts.concurrency).toBe(CLEANUP_WORKER_CONCURRENCY);
    expect(CLEANUP_WORKER_CONCURRENCY).toBe(1);
    expect(workers.worker).toBeDefined();
    expect(workers.cleanupWorker).toBeDefined();
  });

  it('keeps asset-cleanup off the main worker processor', async () => {
    await expect(processJob({ name: JOB_ASSET_CLEANUP, data: { jobId: 'job_1', scanId: 'scan_1' } })).rejects.toThrow(
      'Unknown job name: asset-cleanup',
    );
    expect(processAssetCleanup).not.toHaveBeenCalled();

    await expect(processJob({ name: JOB_PING, data: { requestedAt: '2026-09-10T00:00:00.000Z' } })).resolves.toEqual({
      ok: true,
      requestedAt: '2026-09-10T00:00:00.000Z',
    });
  });

  it('routes asset-cleanup only through the cleanup worker processor', async () => {
    createWorkers();
    const mainProcessor = workerProcessors.get(QUEUE_NAME);
    const cleanupProcessor = workerProcessors.get(CLEANUP_QUEUE_NAME);
    expect(mainProcessor).toBeDefined();
    expect(cleanupProcessor).toBeDefined();

    await expect(
      mainProcessor!({ name: JOB_ASSET_CLEANUP, data: { jobId: 'job_1', scanId: 'scan_1' } }),
    ).rejects.toThrow('Unknown job name: asset-cleanup');
    await expect(processCleanupJob({ name: JOB_PING, data: {} })).rejects.toThrow('Unknown cleanup job name: ping');

    await expect(
      cleanupProcessor!({ name: JOB_ASSET_CLEANUP, data: { jobId: 'job_1', scanId: 'scan_1' } }),
    ).resolves.toEqual({
      ok: true,
    });
    expect(processAssetCleanup).toHaveBeenCalledWith({ jobId: 'job_1', scanId: 'scan_1' });
  });
});
