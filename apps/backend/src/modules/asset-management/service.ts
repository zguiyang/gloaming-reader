import { randomUUID } from 'node:crypto';

import {
  contentAsset as contentAssetTable,
  type ContentAssetMeta,
  readingWork as readingWorkTable,
  uploadedObject as uploadedObjectTable,
} from '@gloaming/db';
import {
  ASSET_CATEGORIES,
  ASSET_LARGEST_OBJECTS_DEFAULT,
  ASSET_SCAN_OBJECT_LIMIT,
  type AssetCategory,
  type AssetCategorySummary,
  type AssetCleanupJob,
  type AssetCleanupJobAccepted,
  type AssetObjectItem,
  type AssetObjectListData,
  type AssetObjectListQuery,
  type AssetScanReport,
  buildPaginationMeta,
  classifyAssetKey,
} from '@gloaming/shared/assets';

import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { AppError } from '@/lib/errors';
import { rootLogger } from '@/lib/logger';
import type { ObjectListItem } from '@/lib/oss';
import { enqueueCleanup } from '@/lib/queue';
import { getRedis } from '@/lib/redis';
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
  snapshotTtlSeconds,
  startLockRenewal,
  toPublicCleanupJob,
} from '@/modules/asset-management/cleanup-store';
import { collectAudioObjectKeys } from '@/modules/content-assets/service';
import { listObjects } from '@/modules/oss';

const logger = rootLogger.child({ module: 'AssetManagement' });

/** Must match `JOB_ASSET_CLEANUP` in jobs/asset-cleanup.ts */
const CLEANUP_JOB_NAME = 'asset-cleanup';
const SCAN_KEY_PREFIX = 'asset-management:scan:';

type ScanSnapshot = {
  report: AssetScanReport;
  objects: AssetObjectItem[];
  orphanKeys: string[];
};

export type ReferencedKeyIndex = {
  keys: Set<string>;
  kindByKey: Map<string, string>;
};

type ParseArtifactManifest = {
  attemptToken: string;
  keys: string[];
};

function scanRedisKey(scanId: string): string {
  return `${SCAN_KEY_PREFIX}${scanId}`;
}

function addReferencedKey(index: ReferencedKeyIndex, key: string | null | undefined, kind?: string | null): void {
  if (!key) return;
  index.keys.add(key);
  if (kind && !index.kindByKey.has(key)) {
    index.kindByKey.set(key, kind);
  }
}

function parseArtifactManifests(originMeta: unknown): ParseArtifactManifest[] {
  if (!originMeta || typeof originMeta !== 'object') return [];
  const value = (originMeta as Record<string, unknown>).workflowParseArtifacts;
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const candidate = entry as { attemptToken?: unknown; keys?: unknown };
    if (
      typeof candidate.attemptToken !== 'string' ||
      !Array.isArray(candidate.keys) ||
      !candidate.keys.every((key): key is string => typeof key === 'string')
    ) {
      return [];
    }
    return [{ attemptToken: candidate.attemptToken, keys: candidate.keys }];
  });
}

/** Collect every storage key currently referenced by database rows. */
export async function collectReferencedStorageKeys(): Promise<ReferencedKeyIndex> {
  const index: ReferencedKeyIndex = { keys: new Set(), kindByKey: new Map() };

  const assets = await db
    .select({
      storageKey: contentAssetTable.storageKey,
      kind: contentAssetTable.kind,
      meta: contentAssetTable.meta,
    })
    .from(contentAssetTable);

  for (const asset of assets) {
    const meta = asset.meta as ContentAssetMeta;
    for (const key of collectAudioObjectKeys({ storageKey: asset.storageKey, meta })) {
      addReferencedKey(index, key, asset.kind);
    }
  }

  const uploaded = await db.select({ storageKey: uploadedObjectTable.storageKey }).from(uploadedObjectTable);
  for (const row of uploaded) {
    addReferencedKey(index, row.storageKey);
  }

  const works = await db.select({ originMeta: readingWorkTable.originMeta }).from(readingWorkTable);
  for (const work of works) {
    for (const manifest of parseArtifactManifests(work.originMeta)) {
      for (const key of manifest.keys) {
        addReferencedKey(index, key);
      }
    }
  }

  return index;
}

/** Pure helper — extract keys from a content_asset-shaped row (unit-testable). */
export function collectKeysFromContentAssetRow(asset: {
  storageKey: string;
  kind: string;
  meta: ContentAssetMeta;
}): string[] {
  return collectAudioObjectKeys({ storageKey: asset.storageKey, meta: asset.meta });
}

export function collectKeysFromOriginMeta(originMeta: unknown): string[] {
  return parseArtifactManifests(originMeta).flatMap((manifest) => manifest.keys);
}

async function listAllObjects(limit: number): Promise<{ objects: ObjectListItem[]; complete: boolean }> {
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

function toIso(value: Date | string | null): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** Reconcile OSS listing against a reference key set. Exported for unit tests. */
export function reconcileObjects(input: {
  listed: ObjectListItem[];
  referenced: ReferencedKeyIndex;
  measuredAt?: Date;
  scanId?: string;
  largestLimit?: number;
  scanComplete?: boolean;
  durationMs?: number;
}): { report: AssetScanReport; objects: AssetObjectItem[]; orphanKeys: string[] } {
  const measuredAt = (input.measuredAt ?? new Date()).toISOString();
  const scanId = input.scanId ?? `scan_${randomUUID()}`;
  const largestLimit = input.largestLimit ?? ASSET_LARGEST_OBJECTS_DEFAULT;
  const scanComplete = input.scanComplete ?? true;
  const durationMs = input.durationMs ?? 0;

  const listedKeys = new Set(input.listed.map((object) => object.key));
  const objects: AssetObjectItem[] = [];
  const orphanKeys: string[] = [];

  let totalBytes = 0;
  let referencedObjectCount = 0;
  let referencedBytes = 0;
  let orphanCount = 0;
  let orphanBytes = 0;

  const categoryTotals = new Map<AssetCategory, { objectCount: number; bytes: number }>();
  for (const category of ASSET_CATEGORIES) {
    categoryTotals.set(category, { objectCount: 0, bytes: 0 });
  }

  for (const listed of input.listed) {
    const kind = input.referenced.kindByKey.get(listed.key);
    const category = classifyAssetKey(listed.key, kind);
    const referenced = input.referenced.keys.has(listed.key);
    const status = referenced ? 'referenced' : 'orphan';
    const item: AssetObjectItem = {
      key: listed.key,
      category,
      status,
      size: listed.size,
      lastModified: toIso(listed.lastModified),
      etag: listed.etag,
    };
    objects.push(item);
    totalBytes += listed.size;

    const bucket = categoryTotals.get(category)!;
    bucket.objectCount += 1;
    bucket.bytes += listed.size;

    if (referenced) {
      referencedObjectCount += 1;
      referencedBytes += listed.size;
    } else {
      orphanCount += 1;
      orphanBytes += listed.size;
      orphanKeys.push(listed.key);
    }
  }

  let missingCount = 0;
  for (const key of input.referenced.keys) {
    if (listedKeys.has(key)) continue;
    missingCount += 1;
    const kind = input.referenced.kindByKey.get(key);
    objects.push({
      key,
      category: classifyAssetKey(key, kind),
      status: 'missing',
      size: 0,
      lastModified: null,
      etag: null,
    });
  }

  const categories: AssetCategorySummary[] = ASSET_CATEGORIES.map((category) => {
    const totals = categoryTotals.get(category)!;
    return { category, objectCount: totals.objectCount, bytes: totals.bytes };
  }).filter((entry) => entry.objectCount > 0 || entry.bytes > 0);

  const largestObjects = objects
    .filter((item) => item.status !== 'missing')
    .toSorted((a, b) => b.size - a.size || a.key.localeCompare(b.key))
    .slice(0, largestLimit);

  const report: AssetScanReport = {
    scanId,
    measuredAt,
    scanComplete,
    objectCount: input.listed.length,
    totalBytes,
    referencedObjectCount,
    referencedBytes,
    orphanCount,
    orphanBytes,
    missingCount,
    durationMs,
    categories,
    largestObjects,
  };

  return { report, objects, orphanKeys };
}

async function saveSnapshot(snapshot: ScanSnapshot): Promise<void> {
  await getRedis().set(scanRedisKey(snapshot.report.scanId), JSON.stringify(snapshot), 'EX', snapshotTtlSeconds());
}

async function loadSnapshot(scanId: string): Promise<ScanSnapshot> {
  const raw = await getRedis().get(scanRedisKey(scanId));
  if (!raw) {
    throw new AppError(HTTP_STATUS.CONFLICT, 'Scan snapshot expired or not found; please scan again');
  }
  try {
    return JSON.parse(raw) as ScanSnapshot;
  } catch (error) {
    logger.warn({ err: error, scanId }, 'Failed to parse scan snapshot');
    throw new AppError(HTTP_STATUS.CONFLICT, 'Scan snapshot expired or not found; please scan again');
  }
}

export async function scanAssets(): Promise<AssetScanReport> {
  const scanId = `scan_${randomUUID()}`;
  const locked = await acquireLock(SCAN_LOCK_KEY, scanId, SCAN_LOCK_TTL_SECONDS);
  if (!locked) {
    throw new AppError(HTTP_STATUS.CONFLICT, 'A scan is already in progress');
  }

  const scanLockRenewal = startLockRenewal(SCAN_LOCK_KEY, scanId, SCAN_LOCK_TTL_SECONDS);
  const heapUsedBefore = process.memoryUsage().heapUsed;
  const startedAt = Date.now();
  try {
    const [listed, referenced] = await Promise.all([
      listAllObjects(ASSET_SCAN_OBJECT_LIMIT),
      collectReferencedStorageKeys(),
    ]);
    const durationMs = Date.now() - startedAt;
    const { report, objects, orphanKeys } = reconcileObjects({
      listed: listed.objects,
      referenced,
      scanId,
      measuredAt: new Date(),
      scanComplete: listed.complete,
      durationMs,
    });
    await saveSnapshot({ report, objects, orphanKeys });
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
  const snapshot = await loadSnapshot(scanId);
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
  const snapshot = await loadSnapshot(scanId);
  if (!snapshot.report.scanComplete) {
    throw new AppError(
      HTTP_STATUS.CONFLICT,
      'Incomplete scan cannot be cleaned up; rescan with a smaller bucket or retry later',
    );
  }
  if (snapshot.orphanKeys.length === 0) {
    throw new AppError(HTTP_STATUS.CONFLICT, 'No orphan objects to clean up');
  }

  const existingJobId = await loadCleanupJobIdForScan(scanId);
  if (existingJobId) {
    const existing = await loadCleanupJob(existingJobId);
    if (existing && isInFlightStatus(existing.status)) {
      return { jobId: existing.jobId, scanId: existing.scanId, status: existing.status };
    }
    if (existing && !isRetryableStatus(existing.status) && existing.status === 'completed') {
      throw new AppError(
        HTTP_STATUS.CONFLICT,
        'Cleanup already completed for this scan; scan again to start a new job',
      );
    }
    if (existing && isRetryableStatus(existing.status)) {
      throw new AppError(HTTP_STATUS.CONFLICT, 'Cleanup already finished with failures; retry the existing job');
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
    throw new AppError(HTTP_STATUS.NOT_FOUND, 'Cleanup job not found');
  }
  return toPublicCleanupJob(record);
}

export async function retryCleanupJob(jobId: string): Promise<AssetCleanupJobAccepted> {
  const record = await loadCleanupJob(jobId);
  if (!record) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, 'Cleanup job not found');
  }
  if (isInFlightStatus(record.status)) {
    return { jobId: record.jobId, scanId: record.scanId, status: record.status };
  }
  if (!isRetryableStatus(record.status)) {
    throw new AppError(HTTP_STATUS.CONFLICT, 'Cleanup job has no failed objects to retry');
  }
  const retryKeys = collectCleanupRetryKeys(record);
  if (retryKeys.length === 0) {
    throw new AppError(HTTP_STATUS.CONFLICT, 'Cleanup job has no failed objects to retry');
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
