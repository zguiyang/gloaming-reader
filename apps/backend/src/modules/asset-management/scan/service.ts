import { randomUUID } from 'node:crypto';

import {
  ASSET_SCAN_OBJECT_LIMIT,
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
import { acquireLock, releaseLock, startLockRenewal } from '@/modules/asset-management/lock-store';
import { collectReferencedStorageKeys } from '@/modules/asset-management/referenced-keys';
import { SCAN_LOCK_KEY, SCAN_LOCK_TTL_SECONDS } from '@/modules/asset-management/scan/config';
import { reconcileObjects } from '@/modules/asset-management/scan/reconcile';
import { loadScanSnapshot, saveScanSnapshot } from '@/modules/asset-management/scan/snapshot';
import { listBucketObjects } from '@/modules/asset-management/storage/list-bucket-objects';

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
