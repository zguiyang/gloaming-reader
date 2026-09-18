import { randomUUID } from 'node:crypto';

import {
  ASSET_SCAN_OBJECT_LIMIT,
  type AssetCleanupJob,
  type AssetCleanupJobAccepted,
  type AssetObjectItem,
  type AssetObjectListData,
  type AssetObjectListQuery,
  type AssetScanReport,
  buildPaginationMeta,
} from '@gloaming/shared/assets';

import { HTTP_STATUS } from '@/constants';
import { AppError } from '@/lib/errors/app-error';
import { ERROR_CODES } from '@/lib/errors/codes';
import { rootLogger } from '@/lib/logger';
import { enqueueCleanup } from '@/lib/queue';
import {
  acquireLock,
  applyCleanupRetryState,
  collectCleanupRetryKeys,
  createQueuedCleanupJob,
  isInFlightStatus,
  isRetryableStatus,
  loadCleanupJob,
  loadCleanupJobIdForScan,
  releaseLock,
  saveCleanupJob,
  SCAN_LOCK_KEY,
  SCAN_LOCK_TTL_SECONDS,
  startLockRenewal,
  toPublicCleanupJob,
} from '@/modules/asset-management/cleanup-store';
import { listBucketObjects } from '@/modules/asset-management/list-bucket-objects';
import { collectReferencedStorageKeys } from '@/modules/asset-management/referenced-keys';
import { reconcileObjects } from '@/modules/asset-management/scan-reconcile';
import { loadScanSnapshot, saveScanSnapshot } from '@/modules/asset-management/scan-snapshot';

const logger = rootLogger.child({ module: 'AssetManagement' });

/** Must match `JOB_ASSET_CLEANUP` in jobs/asset-cleanup.ts */
const CLEANUP_JOB_NAME = 'asset-cleanup';

export async function scanAssets(): Promise<AssetScanReport> {
  const scanId = `scan_${randomUUID()}`;
  const locked = await acquireLock(SCAN_LOCK_KEY, scanId, SCAN_LOCK_TTL_SECONDS);
  if (!locked) {
    throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.ASSET_MANAGEMENT.SCAN_IN_PROGRESS);
  }

  const scanLockRenewal = startLockRenewal(SCAN_LOCK_KEY, scanId, SCAN_LOCK_TTL_SECONDS);
  const heapUsedBefore = process.memoryUsage().heapUsed;
  const startedAt = Date.now();
  try {
    const [listed, referenced] = await Promise.all([
      listBucketObjects({ limit: ASSET_SCAN_OBJECT_LIMIT }),
      collectReferencedStorageKeys(),
    ]);
    const durationMs = Date.now() - startedAt;
    const { report, objects, orphanKeys, legacyDuplicateKeys } = reconcileObjects({
      listed: listed.objects,
      referenced,
      scanId,
      measuredAt: new Date(),
      scanComplete: listed.complete,
      durationMs,
    });
    await saveScanSnapshot({ report, objects, orphanKeys, legacyDuplicateKeys });
    logger.info(
      {
        scanId,
        durationMs,
        objectCount: report.objectCount,
        scanComplete: report.scanComplete,
        heapUsedBefore,
        heapUsedAfter: process.memoryUsage().heapUsed,
      },
      'Asset scan finished',
    );
    return report;
  } finally {
    scanLockRenewal.stop();
    try {
      await releaseLock(SCAN_LOCK_KEY, scanId);
    } catch (error) {
      logger.warn({ err: error }, 'Failed to release scan lock');
    }
  }
}

function compareObjects(
  a: AssetObjectItem,
  b: AssetObjectItem,
  sortBy: AssetObjectListQuery['sortBy'],
  sortOrder: AssetObjectListQuery['sortOrder'],
): number {
  const direction = sortOrder === 'asc' ? 1 : -1;
  if (sortBy === 'size') {
    if (a.size !== b.size) return (a.size - b.size) * direction;
    return a.key.localeCompare(b.key);
  }
  if (sortBy === 'lastModified') {
    const aTime = a.lastModified ? new Date(a.lastModified).getTime() : 0;
    const bTime = b.lastModified ? new Date(b.lastModified).getTime() : 0;
    if (aTime !== bTime) return (aTime - bTime) * direction;
    return a.key.localeCompare(b.key);
  }
  return a.key.localeCompare(b.key) * direction;
}

export async function listScanObjects(scanId: string, query: AssetObjectListQuery): Promise<AssetObjectListData> {
  const snapshot = await loadScanSnapshot(scanId);
  let filtered = snapshot.objects;
  if (query.status !== 'all') {
    filtered = filtered.filter((item) => item.status === query.status);
  }
  if (query.category !== 'all') {
    filtered = filtered.filter((item) => item.category === query.category);
  }

  const sorted = filtered.toSorted((a, b) => compareObjects(a, b, query.sortBy, query.sortOrder));
  const total = sorted.length;
  const start = (query.page - 1) * query.pageSize;
  const items = sorted.slice(start, start + query.pageSize);

  return {
    items,
    pagination: buildPaginationMeta({
      page: query.page,
      pageSize: query.pageSize,
      total,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    }),
  };
}

export async function enqueueOrphanCleanup(scanId: string): Promise<AssetCleanupJobAccepted> {
  const snapshot = await loadScanSnapshot(scanId);
  if (!snapshot.report.scanComplete) {
    throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.ASSET_MANAGEMENT.SCAN_INCOMPLETE);
  }
  if (snapshot.orphanKeys.length === 0) {
    throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.ASSET_MANAGEMENT.NO_ORPHANS);
  }

  const existingJobId = await loadCleanupJobIdForScan(scanId);
  if (existingJobId) {
    const existing = await loadCleanupJob(existingJobId);
    if (existing && isInFlightStatus(existing.status)) {
      return { jobId: existing.jobId, scanId: existing.scanId, status: existing.status };
    }
    if (existing && !isRetryableStatus(existing.status) && existing.status === 'completed') {
      throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.ASSET_MANAGEMENT.CLEANUP_ALREADY_COMPLETED);
    }
    if (existing && isRetryableStatus(existing.status)) {
      throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.ASSET_MANAGEMENT.CLEANUP_RETRY_EXISTING);
    }
  }

  const sizeByKey: Record<string, number> = {};
  for (const item of snapshot.objects) {
    if (item.status === 'orphan') {
      sizeByKey[item.key] = item.size;
    }
  }

  const record = createQueuedCleanupJob({
    scanId,
    pendingKeys: snapshot.orphanKeys,
    sizeByKey,
  });
  await saveCleanupJob(record);
  try {
    await enqueueCleanup(
      CLEANUP_JOB_NAME,
      { jobId: record.jobId, scanId: record.scanId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        jobId: `${CLEANUP_JOB_NAME}:${record.scanId}:${record.attempt}`,
      },
    );
  } catch (error) {
    record.status = 'failed';
    record.error = error instanceof Error ? error.message : 'Failed to enqueue cleanup job';
    await saveCleanupJob(record);
    throw error;
  }

  logger.info({ jobId: record.jobId, scanId, requestedCount: record.requestedCount }, 'Asset cleanup job enqueued');
  return { jobId: record.jobId, scanId: record.scanId, status: record.status };
}

export async function getCleanupJob(jobId: string): Promise<AssetCleanupJob> {
  const record = await loadCleanupJob(jobId);
  if (!record) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.ASSET_MANAGEMENT.CLEANUP_JOB_NOT_FOUND);
  }
  return toPublicCleanupJob(record);
}

export async function retryCleanupJob(jobId: string): Promise<AssetCleanupJobAccepted> {
  const record = await loadCleanupJob(jobId);
  if (!record) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.ASSET_MANAGEMENT.CLEANUP_JOB_NOT_FOUND);
  }
  if (isInFlightStatus(record.status)) {
    return { jobId: record.jobId, scanId: record.scanId, status: record.status };
  }
  if (!isRetryableStatus(record.status)) {
    throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.ASSET_MANAGEMENT.NO_FAILED_OBJECTS);
  }
  const retryKeys = collectCleanupRetryKeys(record);
  if (retryKeys.length === 0) {
    throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.ASSET_MANAGEMENT.NO_FAILED_OBJECTS);
  }

  applyCleanupRetryState(record, retryKeys);
  await saveCleanupJob(record);

  try {
    await enqueueCleanup(
      CLEANUP_JOB_NAME,
      { jobId: record.jobId, scanId: record.scanId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        jobId: `${CLEANUP_JOB_NAME}:${record.scanId}:${record.attempt}`,
      },
    );
  } catch (error) {
    record.status = 'failed';
    record.error = error instanceof Error ? error.message : 'Failed to enqueue cleanup retry';
    await saveCleanupJob(record);
    throw error;
  }

  logger.info({ jobId: record.jobId, scanId: record.scanId, attempt: record.attempt }, 'Asset cleanup retry enqueued');
  return { jobId: record.jobId, scanId: record.scanId, status: record.status };
}
