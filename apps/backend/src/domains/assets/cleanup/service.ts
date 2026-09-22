import { type AssetCleanupJob, type AssetCleanupJobAccepted } from '@gloaming/shared/assets';

import {
  applyCleanupRetryState,
  collectCleanupRetryKeys,
  createQueuedCleanupJob,
  isInFlightStatus,
  isRetryableStatus,
  loadCleanupJob,
  loadCleanupJobIdForScan,
  saveCleanupJob,
  toPublicCleanupJob,
} from '@/domains/assets/cleanup/store';
import { loadScanSnapshot } from '@/domains/assets/scan/snapshot';
import { rootLogger } from '@/infra/logging/logger';
import { enqueueCleanup } from '@/infra/queue';
import { HTTP_STATUS } from '@/shared/constants';
import { AppError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

const logger = rootLogger.child({ module: 'AssetManagement' });

/** Must match `JOB_ASSET_CLEANUP` in jobs/asset-cleanup.ts */
const CLEANUP_JOB_NAME = 'asset-cleanup';

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
