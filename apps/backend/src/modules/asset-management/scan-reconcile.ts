import { randomUUID } from 'node:crypto';

import {
  ASSET_CATEGORIES,
  ASSET_LARGEST_OBJECTS_DEFAULT,
  type AssetCategory,
  type AssetCategorySummary,
  type AssetObjectItem,
  type AssetScanReport,
  classifyAssetKey,
  isLegacyAudioSegmentKey,
} from '@gloaming/shared/assets';

import type { ObjectListItem } from '@/lib/oss';

import type { ReferencedKeyIndex } from './referenced-keys';

function classifyListedObjectStatus(key: string, referenced: ReferencedKeyIndex): AssetObjectItem['status'] {
  if (referenced.formalKeys.has(key) || referenced.externalReferencedKeys.has(key)) {
    return 'referenced';
  }
  if (referenced.legacyAudioSegmentKeys.has(key) || isLegacyAudioSegmentKey(key)) {
    return 'legacy_duplicate_audio';
  }
  return 'orphan';
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
}): {
  report: AssetScanReport;
  objects: AssetObjectItem[];
  orphanKeys: string[];
  legacyDuplicateKeys: string[];
} {
  const measuredAt = (input.measuredAt ?? new Date()).toISOString();
  const scanId = input.scanId ?? `scan_${randomUUID()}`;
  const largestLimit = input.largestLimit ?? ASSET_LARGEST_OBJECTS_DEFAULT;
  const scanComplete = input.scanComplete ?? true;
  const durationMs = input.durationMs ?? 0;

  const listedKeys = new Set(input.listed.map((object) => object.key));
  const objects: AssetObjectItem[] = [];
  const orphanKeys: string[] = [];
  const legacyDuplicateKeys: string[] = [];

  let totalBytes = 0;
  let referencedObjectCount = 0;
  let referencedBytes = 0;
  let orphanCount = 0;
  let orphanBytes = 0;
  let legacyDuplicateCount = 0;
  let legacyDuplicateBytes = 0;

  const categoryTotals = new Map<AssetCategory, { objectCount: number; bytes: number }>();
  for (const category of ASSET_CATEGORIES) {
    categoryTotals.set(category, { objectCount: 0, bytes: 0 });
  }

  for (const listed of input.listed) {
    const kind = input.referenced.kindByKey.get(listed.key);
    const category = classifyAssetKey(listed.key, kind);
    const status = classifyListedObjectStatus(listed.key, input.referenced);
    const referenced = status === 'referenced';
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
    } else if (status === 'legacy_duplicate_audio') {
      legacyDuplicateCount += 1;
      legacyDuplicateBytes += listed.size;
      legacyDuplicateKeys.push(listed.key);
    } else {
      orphanCount += 1;
      orphanBytes += listed.size;
      orphanKeys.push(listed.key);
    }
  }

  let missingCount = 0;
  for (const key of input.referenced.allReferencedKeys) {
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
    legacyDuplicateCount,
    legacyDuplicateBytes,
    missingCount,
    durationMs,
    categories,
    largestObjects,
  };

  return { report, objects, orphanKeys, legacyDuplicateKeys };
}
