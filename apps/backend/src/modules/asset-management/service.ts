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
  type AssetCategory,
  type AssetCategorySummary,
  type AssetCleanupResult,
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
import { getRedis } from '@/lib/redis';
import { deleteObject, listObjects } from '@/modules/oss';

const logger = rootLogger.child({ module: 'AssetManagement' });

const SCAN_TTL_SECONDS = 15 * 60;
const SCAN_LOCK_TTL_SECONDS = 120;
const SCAN_KEY_PREFIX = 'asset-management:scan:';
const SCAN_LOCK_KEY = 'asset-management:scan:lock';

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
    addReferencedKey(index, asset.storageKey, asset.kind);
    for (const key of meta.objectKeys ?? []) {
      addReferencedKey(index, key, asset.kind);
    }
    for (const segment of meta.timeline ?? []) {
      addReferencedKey(index, segment.storageKey, asset.kind);
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
  const keys = new Set<string>();
  keys.add(asset.storageKey);
  for (const key of asset.meta.objectKeys ?? []) keys.add(key);
  for (const segment of asset.meta.timeline ?? []) keys.add(segment.storageKey);
  return [...keys];
}

export function collectKeysFromOriginMeta(originMeta: unknown): string[] {
  return parseArtifactManifests(originMeta).flatMap((manifest) => manifest.keys);
}

async function listAllObjects(): Promise<ObjectListItem[]> {
  const objects: ObjectListItem[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await listObjects(undefined, cursor);
    objects.push(...page.objects);
    if (!page.hasMore || !page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return objects;
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
}): { report: AssetScanReport; objects: AssetObjectItem[]; orphanKeys: string[] } {
  const measuredAt = (input.measuredAt ?? new Date()).toISOString();
  const scanId = input.scanId ?? `scan_${randomUUID()}`;
  const largestLimit = input.largestLimit ?? ASSET_LARGEST_OBJECTS_DEFAULT;

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
    scanComplete: true,
    objectCount: input.listed.length,
    totalBytes,
    referencedObjectCount,
    referencedBytes,
    orphanCount,
    orphanBytes,
    missingCount,
    categories,
    largestObjects,
  };

  return { report, objects, orphanKeys };
}

async function saveSnapshot(snapshot: ScanSnapshot): Promise<void> {
  await getRedis().set(scanRedisKey(snapshot.report.scanId), JSON.stringify(snapshot), 'EX', SCAN_TTL_SECONDS);
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

async function invalidateSnapshot(scanId: string): Promise<void> {
  try {
    await getRedis().del(scanRedisKey(scanId));
  } catch (error) {
    logger.warn({ err: error, scanId }, 'Failed to invalidate scan snapshot');
  }
}

export async function scanAssets(): Promise<AssetScanReport> {
  const scanId = `scan_${randomUUID()}`;
  const redis = getRedis();

  const locked = await redis.set(SCAN_LOCK_KEY, scanId, 'EX', SCAN_LOCK_TTL_SECONDS, 'NX');
  if (locked !== 'OK') {
    throw new AppError(HTTP_STATUS.CONFLICT, 'A scan is already in progress');
  }

  try {
    const [listed, referenced] = await Promise.all([listAllObjects(), collectReferencedStorageKeys()]);
    const { report, objects, orphanKeys } = reconcileObjects({
      listed,
      referenced,
      scanId,
      measuredAt: new Date(),
    });
    await saveSnapshot({ report, objects, orphanKeys });
    return report;
  } finally {
    try {
      const current = await redis.get(SCAN_LOCK_KEY);
      if (current === scanId) {
        await redis.del(SCAN_LOCK_KEY);
      }
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

export async function cleanupOrphanObjects(scanId: string): Promise<AssetCleanupResult> {
  const snapshot = await loadSnapshot(scanId);
  const requestedCount = snapshot.orphanKeys.length;
  const referenced = await collectReferencedStorageKeys();

  const stillOrphan: string[] = [];
  let skippedReferencedCount = 0;
  for (const key of snapshot.orphanKeys) {
    if (referenced.keys.has(key)) {
      skippedReferencedCount += 1;
      continue;
    }
    stillOrphan.push(key);
  }

  const sizeByKey = new Map(snapshot.objects.map((item) => [item.key, item.size]));
  let deletedCount = 0;
  let deletedBytes = 0;
  const failed: AssetCleanupResult['failed'] = [];

  for (const key of stillOrphan) {
    try {
      await deleteObject(key);
      deletedCount += 1;
      deletedBytes += sizeByKey.get(key) ?? 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Delete failed';
      failed.push({ key, error: message });
      logger.warn({ err: error, key, scanId }, 'Failed to delete orphan object');
    }
  }

  await invalidateSnapshot(scanId);

  return {
    scanId,
    requestedCount,
    deletedCount,
    skippedReferencedCount,
    failedCount: failed.length,
    deletedBytes,
    failed,
  };
}
