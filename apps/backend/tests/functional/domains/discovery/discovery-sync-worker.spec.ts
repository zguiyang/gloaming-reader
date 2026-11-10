import { randomUUID } from 'node:crypto';

import { Job, Queue, QueueEvents } from 'bullmq';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { discoverySource as discoverySourceTable } from '@gloaming/db/schema';

import { PROJECT_GUTENBERG_SOURCE_KEY, PROJECT_GUTENBERG_SOURCE_TYPE } from '@/domains/discovery/gutenberg/constants';
import { claimSourceQueued, ensureDiscoverySource } from '@/domains/discovery/sync/repository';
import { db } from '@/infra/db';
import { closeQueue, getQueueConnection } from '@/infra/queue';

const snapshotMocks = vi.hoisted(() => ({ open: vi.fn() }));
/** Stored upstream Last-Modified used to distinguish conditional requests. */
const STORED_LAST_MODIFIED = 'Tue, 01 Jan 2030 00:00:00 GMT';

vi.mock('@/domains/discovery/gutenberg/snapshot-stream', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, openGutenbergSnapshot: snapshotMocks.open };
});

const { createWorkers } = await import('@/worker');

async function removeUniqueQueueKeys(queueName: string): Promise<void> {
  const connection = getQueueConnection();
  const keys = await connection.keys(`bull:${queueName}:*`);
  if (keys.length) await connection.del(...keys);
}

describe('discovery-sync-only worker', () => {
  let sourceId = '';
  let preExisting: typeof discoverySourceTable.$inferSelect | null = null;

  beforeAll(async () => {
    const [existing] = await db
      .select()
      .from(discoverySourceTable)
      .where(eq(discoverySourceTable.sourceKey, PROJECT_GUTENBERG_SOURCE_KEY))
      .limit(1);
    preExisting = existing ?? null;
    const source = await ensureDiscoverySource(PROJECT_GUTENBERG_SOURCE_KEY, PROJECT_GUTENBERG_SOURCE_TYPE);
    sourceId = source.id;
  });

  it('processes its sync job and leaves an unrelated business queue untouched', async () => {
    const suffix = randomUUID();
    const discoveryQueueName = `gloaming-discovery-sync-test-${suffix}`;
    const unrelatedQueueName = `gloaming-business-sentinel-test-${suffix}`;
    const connection = getQueueConnection();
    const discoveryQueue = new Queue(discoveryQueueName, { connection });
    const unrelatedQueue = new Queue(unrelatedQueueName, { connection });
    const queueEvents = new QueueEvents(discoveryQueueName, { connection });
    const { discoverySyncWorker } = createWorkers('discovery-sync-only', {
      discoverySyncQueueName: discoveryQueueName,
    });
    let unrelatedJobId: string | undefined;

    try {
      await db
        .update(discoverySourceTable)
        .set({
          enabled: true,
          syncStatus: 'idle',
          syncStartedAt: null,
          lastErrorSummary: null,
          snapshotLastModified: STORED_LAST_MODIFIED,
        })
        .where(eq(discoverySourceTable.id, sourceId));
      const claimedAt = await claimSourceQueued(sourceId);
      expect(claimedAt).not.toBeNull();
      const payload = { sourceKey: PROJECT_GUTENBERG_SOURCE_KEY, claimedAt: claimedAt!.toISOString() };
      snapshotMocks.open.mockResolvedValue(null);

      await Promise.all([discoverySyncWorker?.waitUntilReady(), queueEvents.waitUntilReady()]);
      const syncJob = await discoveryQueue.add('discovery-sync', payload, { jobId: `sync-${suffix}` });
      const unrelatedJob = await unrelatedQueue.add(
        'content-parse',
        { source: 'sentinel' },
        { jobId: `unrelated-${suffix}` },
      );
      unrelatedJobId = unrelatedJob.id;

      await expect(syncJob.waitUntilFinished(queueEvents, 10_000)).resolves.toEqual({ status: 'not-modified' });

      const [source] = await db
        .select({
          syncStatus: discoverySourceTable.syncStatus,
          lastErrorSummary: discoverySourceTable.lastErrorSummary,
        })
        .from(discoverySourceTable)
        .where(eq(discoverySourceTable.id, sourceId))
        .limit(1);
      expect(source).toEqual({ syncStatus: 'succeeded', lastErrorSummary: null });
      // A job without `force` reaches the service as a conditional request.
      expect(snapshotMocks.open).toHaveBeenCalledTimes(1);
      expect(snapshotMocks.open).toHaveBeenLastCalledWith(
        expect.objectContaining({ ifModifiedSince: STORED_LAST_MODIFIED }),
      );
      expect(await unrelatedJob.getState()).toBe('waiting');
      expect(await unrelatedQueue.getJobCounts('waiting', 'active', 'completed')).toEqual({
        waiting: 1,
        active: 0,
        completed: 0,
      });

      // A job carrying `force: true` reaches the service as an unconditional
      // request: the stored Last-Modified is dropped before the fetch.
      await db
        .update(discoverySourceTable)
        .set({
          syncStatus: 'idle',
          syncStartedAt: null,
          syncFinishedAt: null,
          lastErrorSummary: null,
          snapshotLastModified: STORED_LAST_MODIFIED,
        })
        .where(eq(discoverySourceTable.id, sourceId));
      const forcedClaim = await claimSourceQueued(sourceId);
      expect(forcedClaim).not.toBeNull();
      const forcedPayload = {
        sourceKey: PROJECT_GUTENBERG_SOURCE_KEY,
        claimedAt: forcedClaim!.toISOString(),
        force: true,
      };
      const forcedJob = await discoveryQueue.add('discovery-sync', forcedPayload, { jobId: `sync-force-${suffix}` });
      await expect(forcedJob.waitUntilFinished(queueEvents, 10_000)).resolves.toEqual({ status: 'not-modified' });
      expect(snapshotMocks.open).toHaveBeenCalledTimes(2);
      expect(snapshotMocks.open).toHaveBeenLastCalledWith(expect.objectContaining({ ifModifiedSince: null }));
    } finally {
      await discoverySyncWorker?.close();
      await queueEvents.close();
      if (unrelatedJobId) {
        const job = await Job.fromId(unrelatedQueue, unrelatedJobId);
        await job?.remove().catch(() => undefined);
      }
      const syncJobs = await discoveryQueue.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed'], 0, -1);
      for (const job of syncJobs) await job.remove().catch(() => undefined);
      await Promise.all([discoveryQueue.obliterate(), unrelatedQueue.obliterate()]);
      await Promise.all([removeUniqueQueueKeys(discoveryQueueName), removeUniqueQueueKeys(unrelatedQueueName)]);
      await Promise.all([discoveryQueue.close(), unrelatedQueue.close()]);
    }
  });

  afterAll(async () => {
    if (preExisting) {
      await db
        .update(discoverySourceTable)
        .set({
          enabled: preExisting.enabled,
          syncStatus: preExisting.syncStatus,
          syncStartedAt: preExisting.syncStartedAt,
          syncFinishedAt: preExisting.syncFinishedAt,
          lastSuccessAt: preExisting.lastSuccessAt,
          lastErrorSummary: preExisting.lastErrorSummary,
          snapshotLastModified: preExisting.snapshotLastModified,
          snapshotVersion: preExisting.snapshotVersion,
          updatedAt: preExisting.updatedAt,
        })
        .where(eq(discoverySourceTable.id, sourceId));
    } else if (sourceId) {
      await db.delete(discoverySourceTable).where(eq(discoverySourceTable.id, sourceId));
    }
    await closeQueue();
  });
});
