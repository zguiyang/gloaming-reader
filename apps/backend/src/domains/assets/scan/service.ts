import { randomUUID } from 'node:crypto';

import { ASSET_SCAN_OBJECT_LIMIT, type AssetScanReport } from '@gloaming/shared/assets';

import { acquireLock, releaseLock, startLockRenewal } from '@/domains/assets/management/lock-store';
import { collectReferencedStorageKeys } from '@/domains/assets/management/referenced-keys';
import { SCAN_LOCK_KEY, SCAN_LOCK_TTL_SECONDS } from '@/domains/assets/scan/config';
import { reconcileObjects } from '@/domains/assets/scan/reconcile';
import { saveScanSnapshot } from '@/domains/assets/scan/snapshot';
import { listBucketObjects } from '@/domains/assets/storage/list-bucket-objects';
import { rootLogger } from '@/infra/logging/logger';
import { HTTP_STATUS } from '@/shared/constants';
import { AppError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

const logger = rootLogger.child({ module: 'AssetManagement' });

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
    const { report, orphanCandidates } = reconcileObjects({
      listed: listed.objects,
      referenced,
      scanId,
      measuredAt: new Date(),
      scanComplete: listed.complete,
      durationMs,
    });
    await saveScanSnapshot({ report, orphanCandidates });
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
