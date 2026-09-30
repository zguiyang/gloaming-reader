import { randomUUID } from 'node:crypto';

import {
  ASSET_CATEGORIES,
  type AssetCategory,
  type AssetCategorySummary,
  type AssetScanReport,
  classifyAssetKey,
  isLegacyAudioSegmentKey,
} from '@gloaming/shared/assets';

import type { ReferencedKeyIndex } from '@/domains/assets/management/referenced-keys';
import type { ObjectListItem } from '@/infra/storage';

function classifyListedObjectStatus(
  key: string,
  referenced: ReferencedKeyIndex,
): 'referenced' | 'orphan' | 'legacy_duplicate_audio' {
  if (referenced.formalKeys.has(key) || referenced.externalReferencedKeys.has(key)) {
    return 'referenced';
  }
  if (referenced.legacyAudioSegmentKeys.has(key) || isLegacyAudioSegmentKey(key)) {
    return 'legacy_duplicate_audio';
  }
  return 'orphan';
}

/** Reconcile OSS listing against a reference key set. Exported for unit tests. */
export function reconcileObjects(input: {
  listed: ObjectListItem[];
  referenced: ReferencedKeyIndex;
  measuredAt?: Date;
  scanId?: string;
  scanComplete?: boolean;
  durationMs?: number;
}): {
  report: AssetScanReport;
  orphanCandidates: Array<{ key: string; size: number }>;
} {
  const measuredAt = (input.measuredAt ?? new Date()).toISOString();
  const scanId = input.scanId ?? `scan_${randomUUID()}`;
  const scanComplete = input.scanComplete ?? true;
  const durationMs = input.durationMs ?? 0;

  const listedKeys = new Set(input.listed.map((object) => object.key));
  const orphanCandidates: Array<{ key: string; size: number }> = [];

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
    } else {
      orphanCount += 1;
      orphanBytes += listed.size;
      orphanCandidates.push({ key: listed.key, size: listed.size });
    }
  }

  let missingCount = 0;
  for (const key of input.referenced.allReferencedKeys) {
    if (listedKeys.has(key)) continue;
    missingCount += 1;
  }

  const categories: AssetCategorySummary[] = ASSET_CATEGORIES.map((category) => {
    const totals = categoryTotals.get(category)!;
    return { category, objectCount: totals.objectCount, bytes: totals.bytes };
  }).filter((entry) => entry.objectCount > 0 || entry.bytes > 0);

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
  };

  return { report, orphanCandidates };
}
