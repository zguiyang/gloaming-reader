import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JOB_ASSET_CLEANUP } from '@/application/jobs/asset-cleanup';
import { JOB_PING } from '@/application/jobs/ping';

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
const processPersonalWorkCleanupJob = vi.fn().mockResolvedValue({ ok: true });
const processPersonalTaggingJob = vi.fn().mockResolvedValue({ ok: true });
const dispatchQueuedPersonalTagRuns = vi.fn().mockResolvedValue(undefined);
const finalizeFailedPersonalTagRun = vi.fn().mockResolvedValue(undefined);
const processPublicClassification = vi.fn().mockResolvedValue({ status: 'completed' });
const dispatchDuePublicClassifications = vi.fn().mockResolvedValue(0);
const processSourceRecordMaterialize = vi.fn().mockResolvedValue({ status: 'processing' });

vi.mock('@/application/jobs/asset-cleanup', () => ({
  JOB_ASSET_CLEANUP: 'asset-cleanup',
  processAssetCleanup: (...args: unknown[]) => processAssetCleanup(...args),
  JOB_PERSONAL_WORK_CLEANUP: 'personal-work-cleanup',
  processPersonalWorkCleanupJob: (...args: unknown[]) => processPersonalWorkCleanupJob(...args),
}));

vi.mock('@/application/jobs/content-parse', () => ({
  JOB_CONTENT_PARSE: 'content-parse',
  processContentParse: vi.fn(),
}));

vi.mock('@/application/jobs/source-record-materialize', () => ({
  JOB_SOURCE_RECORD_MATERIALIZE: 'source-record-materialize',
  processSourceRecordMaterialize: (...args: unknown[]) => processSourceRecordMaterialize(...args),
}));

vi.mock('@/application/jobs/metadata-enrich', () => ({
  JOB_METADATA_ENRICH: 'metadata-enrich',
  processMetadataEnrich: vi.fn(),
}));

vi.mock('@/application/jobs/part-audio-generate', () => ({
  JOB_PART_AUDIO_GENERATE: 'part-audio-generate',
  processPartAudioGenerate: vi.fn(),
}));

vi.mock('@/application/jobs/work-metadata-fill', () => ({
  JOB_METADATA_FILL: 'metadata-fill',
  processWorkMetadataFill: vi.fn(),
}));

vi.mock('@/domains/library/tags/personal-ai-tagging', () => ({
  JOB_PERSONAL_TAGGING: 'personal-tagging',
  processPersonalTaggingJob: (...args: unknown[]) => processPersonalTaggingJob(...args),
  dispatchQueuedPersonalTagRuns: (...args: unknown[]) => dispatchQueuedPersonalTagRuns(...args),
  finalizeFailedPersonalTagRun: (...args: unknown[]) => finalizeFailedPersonalTagRun(...args),
}));

vi.mock('@/application/jobs/public-classification', () => ({
  JOB_PUBLIC_CLASSIFICATION: 'public-classification',
  processPublicClassification: (...args: unknown[]) => processPublicClassification(...args),
}));

vi.mock('@/domains/discovery/categories', () => ({
  dispatchDuePublicClassifications: (...args: unknown[]) => dispatchDuePublicClassifications(...args),
}));

const {
  CLEANUP_QUEUE_NAME,
  closeQueue,
  enqueue,
  enqueueCleanup,
  enqueueDiscoveryImport,
  enqueuePersonalTagging,
  enqueuePublicClassification,
  PERSONAL_TAG_QUEUE_NAME,
  PUBLIC_CLASSIFICATION_QUEUE_NAME,
  QUEUE_NAME,
} = await import('@/infra/queue');
const {
  CLEANUP_WORKER_CONCURRENCY,
  PERSONAL_TAG_WORKER_CONCURRENCY,
  PUBLIC_CLASSIFICATION_WORKER_CONCURRENCY,
  createWorkers,
  processCleanupJob,
  processDiscoveryImportJob,
  processJob,
} = await import('@/worker');

describe('cleanup queue isolation', () => {
  beforeEach(() => {
    queueAddCalls.length = 0;
    queueCloseCalls.length = 0;
    workerConstructors.length = 0;
    workerProcessors.clear();
    processAssetCleanup.mockClear();
    processPersonalWorkCleanupJob.mockClear();
    processPersonalTaggingJob.mockClear();
    dispatchQueuedPersonalTagRuns.mockClear();
    finalizeFailedPersonalTagRun.mockClear();
    processPublicClassification.mockClear();
    dispatchDuePublicClassifications.mockClear();
    processSourceRecordMaterialize.mockClear();
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

  it('enqueues Discover import jobs on their dedicated queue', async () => {
    await enqueueDiscoveryImport('source-record-materialize', { sourceRecordId: 'record_1' });

    expect(queueAddCalls).toEqual([{ queueName: 'gloaming-discovery-import', name: 'source-record-materialize' }]);
  });

  it('closes all dedicated queues', async () => {
    await enqueueDiscoveryImport('source-record-materialize', { sourceRecordId: 'record_1' });
    await enqueueCleanup(JOB_ASSET_CLEANUP, { jobId: 'job_1', scanId: 'scan_1' });
    await enqueuePersonalTagging('personal-tagging', { runId: 'run_1' });
    await enqueuePublicClassification('public-classification', { sourceRecordId: 'record_1' });
    await enqueue(JOB_PING, { requestedAt: '2026-09-10T00:00:00.000Z' });
    await closeQueue();

    expect(queueCloseCalls).toEqual([
      'gloaming-discovery-import',
      PUBLIC_CLASSIFICATION_QUEUE_NAME,
      PERSONAL_TAG_QUEUE_NAME,
      CLEANUP_QUEUE_NAME,
      QUEUE_NAME,
    ]);
  });

  it('starts a dedicated cleanup worker with concurrency 1', () => {
    const workers = createWorkers();

    expect(workerConstructors).toHaveLength(5);
    expect(workerConstructors.map((entry) => entry.name)).toEqual([
      QUEUE_NAME,
      CLEANUP_QUEUE_NAME,
      PERSONAL_TAG_QUEUE_NAME,
      PUBLIC_CLASSIFICATION_QUEUE_NAME,
      'gloaming-discovery-import',
    ]);
    expect(workerConstructors[0]?.opts.concurrency).toBeUndefined();
    expect(workerConstructors[1]?.opts.concurrency).toBe(CLEANUP_WORKER_CONCURRENCY);
    expect(workerConstructors[2]?.opts.concurrency).toBe(PERSONAL_TAG_WORKER_CONCURRENCY);
    expect(workerConstructors[3]?.opts.concurrency).toBe(PUBLIC_CLASSIFICATION_WORKER_CONCURRENCY);
    expect(CLEANUP_WORKER_CONCURRENCY).toBe(1);
    expect(PERSONAL_TAG_WORKER_CONCURRENCY).toBe(2);
    expect(PUBLIC_CLASSIFICATION_WORKER_CONCURRENCY).toBe(1);
    expect(workers.worker).toBeDefined();
    expect(workers.cleanupWorker).toBeDefined();
    expect(workers.personalTagWorker).toBeDefined();
    expect(workers.publicClassificationWorker).toBeDefined();
    expect(workers.discoveryImportWorker).toBeDefined();
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

  it('keeps legacy materialization jobs supported by the full worker', async () => {
    await expect(
      processJob({ name: 'source-record-materialize', data: { sourceRecordId: 'record_1' } }),
    ).resolves.toEqual({ status: 'processing' });
    expect(processSourceRecordMaterialize).toHaveBeenCalledWith({ sourceRecordId: 'record_1' });

    await expect(
      processDiscoveryImportJob({ name: 'source-record-materialize', data: { sourceRecordId: 'record_2' } }),
    ).resolves.toEqual({ status: 'processing' });
    expect(processSourceRecordMaterialize).toHaveBeenCalledWith({ sourceRecordId: 'record_2' });
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

    await expect(
      cleanupProcessor!({ name: 'personal-work-cleanup', data: { keys: ['epub/key'], uploadContentHash: 'hash' } }),
    ).resolves.toEqual({ ok: true });
    expect(processPersonalWorkCleanupJob).toHaveBeenCalledWith({ keys: ['epub/key'], uploadContentHash: 'hash' });
  });
});
