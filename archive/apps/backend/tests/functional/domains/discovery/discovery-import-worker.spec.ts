import { randomUUID } from 'node:crypto';

import { Queue, QueueEvents } from 'bullmq';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { closeQueue, getQueueConnection } from '@/infra/queue';

const handlers = vi.hoisted(() => ({
  contentParse: vi.fn(async (data: unknown) => ({ kind: 'parsed', data })),
  materialize: vi.fn(async (data: unknown) => ({ kind: 'materialized', data })),
}));

vi.mock('@/application/jobs/content-parse', () => ({
  JOB_CONTENT_PARSE: 'content-parse',
  processContentParse: handlers.contentParse,
}));

vi.mock('@/application/jobs/source-record-materialize', () => ({
  JOB_SOURCE_RECORD_MATERIALIZE: 'source-record-materialize',
  processSourceRecordMaterialize: handlers.materialize,
}));

const { createWorkers } = await import('@/worker');

describe('discovery-import-only Worker queue isolation on test Redis', () => {
  it('consumes only import jobs and leaves business and AI sentinels waiting', async () => {
    const suffix = randomUUID();
    const importQueueName = `gloaming-discovery-import-test-${suffix}`;
    const businessQueueName = `gloaming-business-sentinel-test-${suffix}`;
    const aiQueueName = `gloaming-ai-sentinel-test-${suffix}`;
    const connection = getQueueConnection();
    const importQueue = new Queue(importQueueName, { connection });
    const businessQueue = new Queue(businessQueueName, { connection });
    const aiQueue = new Queue(aiQueueName, { connection });
    const queueEvents = new QueueEvents(importQueueName, { connection });
    let discoveryImportWorker: ReturnType<typeof createWorkers>['discoveryImportWorker'];

    try {
      handlers.contentParse.mockClear();
      handlers.materialize.mockClear();
      await queueEvents.waitUntilReady();

      const materializeJob = await importQueue.add(
        'source-record-materialize',
        { sourceRecordId: 'source-record-test' },
        { jobId: `materialize-${suffix}` },
      );
      const parseJob = await importQueue.add(
        'content-parse',
        { workId: 'source-work-test', retryJobToken: 'retry-test', processingLane: 'discovery' },
        { jobId: `parse-${suffix}` },
      );
      await businessQueue.add('ping', { marker: 'business' }, { jobId: `business-${suffix}` });
      await aiQueue.add('personal-tagging', { marker: 'ai' }, { jobId: `ai-${suffix}` });

      expect(await importQueue.getJobCounts('waiting', 'active')).toEqual({ waiting: 2, active: 0 });
      discoveryImportWorker = createWorkers('discovery-import-only', {
        discoveryImportQueueName: importQueueName,
      }).discoveryImportWorker;
      await discoveryImportWorker?.waitUntilReady();

      await expect(materializeJob.waitUntilFinished(queueEvents, 10_000)).resolves.toMatchObject({
        kind: 'materialized',
      });
      await expect(parseJob.waitUntilFinished(queueEvents, 10_000)).resolves.toMatchObject({ kind: 'parsed' });
      expect(handlers.materialize).toHaveBeenCalledWith({ sourceRecordId: 'source-record-test' });
      expect(handlers.contentParse).toHaveBeenCalledWith({
        workId: 'source-work-test',
        retryJobToken: 'retry-test',
        processingLane: 'discovery',
      });
      expect(await businessQueue.getJobCounts('waiting', 'active', 'completed')).toEqual({
        waiting: 1,
        active: 0,
        completed: 0,
      });
      expect(await aiQueue.getJobCounts('waiting', 'active', 'completed')).toEqual({
        waiting: 1,
        active: 0,
        completed: 0,
      });
    } finally {
      await discoveryImportWorker?.close();
      await queueEvents.close();
      await Promise.all([importQueue.obliterate(), businessQueue.obliterate(), aiQueue.obliterate()]);
      await Promise.all([importQueue.close(), businessQueue.close(), aiQueue.close()]);
      await closeQueue();
    }
  });
});

afterAll(async () => {
  await closeQueue();
});
