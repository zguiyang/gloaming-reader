import { randomUUID } from 'node:crypto';

import { Queue } from 'bullmq';
import { afterAll, describe, expect, it } from 'vitest';

import { enqueueSourceRecordMaterialization, SOURCE_RECORD_MATERIALIZE_JOB } from '@/domains/library/save-intent';
import { closeQueue, getQueueConnection, QUEUE_NAME } from '@/infra/queue';

/**
 * Real BullMQ enqueue validation for the materialization job. This spec never
 * mocks `enqueue`, so BullMQ's own `Custom Id cannot contain :` check runs
 * against the isolated test Redis database. No worker consumes these jobs.
 */
describe('source-record materialize real enqueue on test Redis', () => {
  const sourceRecordId = randomUUID();
  const jobId = `${SOURCE_RECORD_MATERIALIZE_JOB}-${sourceRecordId}`;
  const queue = new Queue(QUEUE_NAME, { connection: getQueueConnection() });

  afterAll(async () => {
    // Only this spec enqueues materialize jobs for real; remove every leftover.
    const materializeJobs = await queue.getJobs(['waiting', 'active', 'delayed', 'completed', 'failed']);
    for (const job of materializeJobs) {
      if (job.name === SOURCE_RECORD_MATERIALIZE_JOB) {
        await job.remove().catch(() => undefined);
      }
    }
    await queue.close();
    await closeQueue();
  });

  it('accepts the custom job id, stays free of ":", and deduplicates repeated saves', async () => {
    expect(jobId).not.toContain(':');
    expect(Number.isNaN(Number(jobId))).toBe(true);

    await expect(enqueueSourceRecordMaterialization(sourceRecordId)).resolves.toBeUndefined();
    await expect(enqueueSourceRecordMaterialization(sourceRecordId)).resolves.toBeUndefined();

    const job = await queue.getJob(jobId);
    expect(job).toBeTruthy();
    expect(job!.name).toBe(SOURCE_RECORD_MATERIALIZE_JOB);
    expect(job!.data).toEqual({ sourceRecordId });

    const queued = await queue.getJobs(['waiting', 'active', 'delayed']);
    const matching = queued.filter(
      (candidate) =>
        candidate.name === SOURCE_RECORD_MATERIALIZE_JOB &&
        (candidate.data as { sourceRecordId?: string }).sourceRecordId === sourceRecordId,
    );
    expect(matching).toHaveLength(1);
    expect(matching[0]!.id).toBe(jobId);
  });
});
