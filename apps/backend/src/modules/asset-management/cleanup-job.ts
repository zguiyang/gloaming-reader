import { randomUUID } from 'node:crypto';

import { ASSET_SCAN_OBJECT_LIMIT, type AssetCleanupJobVerification } from '@gloaming/shared/assets';

import { rootLogger } from '@/lib/logger';
import type { ObjectListItem } from '@/lib/oss';
import {
  acquireLock,
  CLEANUP_BATCH_SIZE,
  CLEANUP_LOCK_KEY,
  CLEANUP_LOCK_TTL_SECONDS,
  type CleanupJobRecord,
  loadCleanupJob,
  mergeFailures,
  releaseLock,
  saveCleanupJob,
  startLockRenewal,
} from '@/modules/asset-management/cleanup-store';
import { collectReferencedStorageKeys, reconcileObjects } from '@/modules/asset-management/service';
import { deleteManyObjects, listObjects } from '@/modules/oss';

const logger = rootLogger.child({ module: 'AssetCleanupJob' });

export type AssetCleanupJobData = {
  jobId: string;
  scanId: string;
};

export function resolveCleanupTerminalStatus(input: {
  failedCount: number;
  verification?: AssetCleanupJobVerification;
}): 'completed' | 'partial' {
  const { failedCount, verification } = input;
  if (failedCount > 0) return 'partial';
  if (verification?.ran !== true) return 'partial';
  if (verification.scanComplete !== true) return 'partial';
  if (verification.orphanCount !== 0) return 'partial';
  return 'completed';
}

export async function runAssetCleanupJob(data: AssetCleanupJobData): Promise<{ ok: true }> {
  const record = await loadCleanupJob(data.jobId);
  if (!record) {
    throw new Error(`Cleanup job state missing for ${data.jobId}`);
  }
  if (record.status === 'completed') {
    return { ok: true };
  }

  const executionToken = randomUUID();
  const locked = await acquireLock(CLEANUP_LOCK_KEY, executionToken, CLEANUP_LOCK_TTL_SECONDS);
  if (!locked) {
    throw new Error('Another cleanup job holds the cleanup lock');
  }

  const renewal = startLockRenewal(CLEANUP_LOCK_KEY, executionToken, CLEANUP_LOCK_TTL_SECONDS);
  try {
    record.status = 'running';
    record.error = undefined;
    await persistOwnedCleanupJob(record, executionToken);

    while (record.pendingKeys.length > 0) {
      if (renewal.failed()) {
        logger.warn({ jobId: record.jobId, scanId: record.scanId }, 'Cleanup lock renewal failed');
        throw new Error('Cleanup lock renewal failed');
      }

      const batch = record.pendingKeys.slice(0, CLEANUP_BATCH_SIZE);
      const referenced = await collectReferencedStorageKeys();
      const stillOrphan: string[] = [];
      for (const key of batch) {
        if (referenced.allReferencedKeys.has(key)) {
          record.skippedReferencedCount += 1;
        } else {
          stillOrphan.push(key);
        }
      }

      const deleted = await deleteManyObjects(stillOrphan);
      record.deletedCount += deleted.deleted.length;
      for (const key of deleted.deleted) {
        record.deletedBytes += record.sizeByKey[key] ?? 0;
      }
      const remainingFailed = record.failed.filter((entry) => !deleted.deleted.includes(entry.key));
      record.failed = mergeFailures(remainingFailed, deleted.failed);
      record.failedCount = record.failed.length;
      record.processedCount = Math.min(record.requestedCount, record.processedCount + batch.length);
      record.pendingKeys = record.pendingKeys.slice(batch.length);
      await persistOwnedCleanupJob(record, executionToken);
    }

    if (renewal.failed()) {
      logger.warn({ jobId: record.jobId, scanId: record.scanId }, 'Cleanup lock renewal failed');
      throw new Error('Cleanup lock renewal failed');
    }

    record.verification = await verifyStorageAfterCleanup(record.scanId);
    record.status = resolveCleanupTerminalStatus({
      failedCount: record.failedCount,
      verification: record.verification,
    });
    await persistOwnedCleanupJob(record, executionToken);
    logger.info(
      {
        jobId: record.jobId,
        scanId: record.scanId,
        status: record.status,
        deletedCount: record.deletedCount,
        failedCount: record.failedCount,
      },
      'Asset cleanup job finished',
    );
    return { ok: true };
  } catch (error) {
    record.status = record.deletedCount > 0 || record.skippedReferencedCount > 0 ? 'partial' : 'failed';
    record.error = error instanceof Error ? error.message : 'Cleanup job failed';
    record.failedCount = record.failed.length;
    try {
      const saved = await saveCleanupJob(record, { executionToken });
      if (!saved) {
        logger.warn({ jobId: record.jobId, scanId: record.scanId }, 'stale worker / lock ownership lost');
      }
    } catch (persistError) {
      logger.warn(
        { err: persistError, jobId: record.jobId, scanId: record.scanId },
        'Failed to persist cleanup failure state',
      );
    }
    logger.warn({ err: error, jobId: record.jobId, scanId: record.scanId }, 'Asset cleanup job failed');
    throw error;
  } finally {
    renewal.stop();
    await releaseLock(CLEANUP_LOCK_KEY, executionToken);
  }
}

async function persistOwnedCleanupJob(record: CleanupJobRecord, executionToken: string): Promise<void> {
  const saved = await saveCleanupJob(record, { executionToken });
  if (!saved) {
    throw new Error('Cleanup lock ownership lost');
  }
}

async function listAllObjectsBounded(limit: number): Promise<{ objects: ObjectListItem[]; complete: boolean }> {
  const objects: ObjectListItem[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await listObjects(undefined, cursor);
    for (const object of page.objects) {
      if (objects.length >= limit) {
        return { objects, complete: false };
      }
      objects.push(object);
    }
    if (!page.hasMore || !page.nextCursor) {
      return { objects, complete: true };
    }
    cursor = page.nextCursor;
  }
}

async function verifyStorageAfterCleanup(scanId: string): Promise<AssetCleanupJobVerification> {
  const [listed, referenced] = await Promise.all([
    listAllObjectsBounded(ASSET_SCAN_OBJECT_LIMIT),
    collectReferencedStorageKeys(),
  ]);
  const { report } = reconcileObjects({
    listed: listed.objects,
    referenced,
    scanId,
    scanComplete: listed.complete,
    durationMs: 0,
  });
  return {
    ran: true,
    orphanCount: report.orphanCount,
    missingCount: report.missingCount,
    scanComplete: listed.complete,
    scanId,
  };
}
