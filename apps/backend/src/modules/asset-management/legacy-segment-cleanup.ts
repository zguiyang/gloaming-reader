import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { inArray } from 'drizzle-orm';

import { contentAsset as contentAssetTable } from '@gloaming/db';
import {
  ASSET_SCAN_OBJECT_LIMIT,
  isLegacyAudioSegmentKey,
  parseLegacyAudioSegmentKey,
  siblingChapterKeyForSegment,
} from '@gloaming/shared/assets';

import { db } from '@/db';
import { rootLogger } from '@/lib/logger';
import type { ObjectListItem } from '@/lib/oss';
import { CLEANUP_BATCH_SIZE } from '@/modules/asset-management/cleanup-store';
import { collectReferencedStorageKeys } from '@/modules/asset-management/service';
import { deleteManyObjects, listObjects, objectExists } from '@/modules/oss';

const logger = rootLogger.child({ module: 'LegacySegmentCleanup' });

export type LegacySegmentSkipReason =
  'still_referenced' | 'invalid_key' | 'asset_missing' | 'asset_not_ready' | 'generation_running' | 'chapter_missing';

export type LegacySegmentCandidate = {
  key: string;
  size: number;
  partId: string;
  kind: string;
  contentHash: string;
  chapterKey: string;
};

export type LegacySegmentDecision =
  | { key: string; size: number; eligible: true; candidate: LegacySegmentCandidate }
  | { key: string; size: number; eligible: false; reason: LegacySegmentSkipReason; detail?: string };

export type LegacySegmentCleanupManifest = {
  createdAt: string;
  mode: 'dry-run' | 'execute';
  scanComplete: boolean;
  listedSegmentCount: number;
  referencedSkippedCount: number;
  eligibleKeys: string[];
  skipped: Array<{ key: string; reason: LegacySegmentSkipReason; detail?: string }>;
  deletedKeys: string[];
  failed: Array<{ key: string; error: string }>;
};

type AudioAssetRow = {
  id: string;
  partId: string | null;
  kind: string;
  storageKey: string;
  status: string;
  generationLeaseExpiresAt: Date | null;
};

export function isActiveAudioGeneration(asset: {
  status: string;
  generationLeaseExpiresAt: Date | null | undefined;
  now?: Date;
}): boolean {
  if (asset.status !== 'generating') return false;
  const lease = asset.generationLeaseExpiresAt;
  if (!lease) return true;
  const now = asset.now ?? new Date();
  return lease.getTime() > now.getTime();
}

/** Pure eligibility check once listing, reference set, and asset rows are known. */
export function evaluateLegacySegmentCandidate(input: {
  object: Pick<ObjectListItem, 'key' | 'size'>;
  referencedKeys: Set<string>;
  assetByPartKind: Map<string, AudioAssetRow>;
  chapterExistsByKey: Map<string, boolean>;
  now?: Date;
}): LegacySegmentDecision {
  const { object, referencedKeys, assetByPartKind, chapterExistsByKey, now } = input;
  if (referencedKeys.has(object.key)) {
    return { key: object.key, size: object.size, eligible: false, reason: 'still_referenced' };
  }

  const parts = parseLegacyAudioSegmentKey(object.key);
  const chapterKey = siblingChapterKeyForSegment(object.key);
  if (!parts || !chapterKey) {
    return { key: object.key, size: object.size, eligible: false, reason: 'invalid_key' };
  }

  const asset = assetByPartKind.get(`${parts.partId}:${parts.kind}`);
  if (!asset || !asset.partId) {
    return { key: object.key, size: object.size, eligible: false, reason: 'asset_missing' };
  }
  if (
    isActiveAudioGeneration({
      status: asset.status,
      generationLeaseExpiresAt: asset.generationLeaseExpiresAt,
      now,
    })
  ) {
    return { key: object.key, size: object.size, eligible: false, reason: 'generation_running' };
  }
  if (asset.status !== 'ready') {
    return {
      key: object.key,
      size: object.size,
      eligible: false,
      reason: 'asset_not_ready',
      detail: `status=${asset.status}`,
    };
  }

  const chapterKeyToCheck = asset.storageKey || chapterKey;
  const chapterExists = chapterExistsByKey.get(chapterKeyToCheck);
  if (chapterExists !== true) {
    return {
      key: object.key,
      size: object.size,
      eligible: false,
      reason: 'chapter_missing',
      detail: chapterKeyToCheck,
    };
  }

  return {
    key: object.key,
    size: object.size,
    eligible: true,
    candidate: {
      key: object.key,
      size: object.size,
      partId: parts.partId,
      kind: parts.kind,
      contentHash: parts.contentHash,
      chapterKey: chapterKeyToCheck,
    },
  };
}

async function listAllObjectsBounded(
  prefix: string | undefined,
  limit: number,
): Promise<{ objects: ObjectListItem[]; complete: boolean }> {
  const objects: ObjectListItem[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await listObjects(prefix, cursor);
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

function assetPartKindKey(partId: string, kind: string): string {
  return `${partId}:${kind}`;
}

/**
 * Build a precise legacy-segment cleanup manifest.
 * Default mode is dry-run; execute deletes only keys that pass live revalidation.
 */
export async function runLegacySegmentCleanup(options: {
  execute?: boolean;
  manifestPath?: string;
  objectLimit?: number;
}): Promise<{ manifest: LegacySegmentCleanupManifest; manifestPath: string }> {
  const execute = options.execute === true;
  const objectLimit = options.objectLimit ?? ASSET_SCAN_OBJECT_LIMIT;
  const createdAt = new Date().toISOString();

  const [listed, referenced] = await Promise.all([
    listAllObjectsBounded('part-audio/', objectLimit),
    collectReferencedStorageKeys(),
  ]);

  const segmentObjects = listed.objects.filter((object) => isLegacyAudioSegmentKey(object.key));
  const partIds = [
    ...new Set(
      segmentObjects
        .map((object) => parseLegacyAudioSegmentKey(object.key)?.partId)
        .filter((partId): partId is string => Boolean(partId)),
    ),
  ];

  const assets =
    partIds.length === 0
      ? []
      : await db
          .select({
            id: contentAssetTable.id,
            partId: contentAssetTable.partId,
            kind: contentAssetTable.kind,
            storageKey: contentAssetTable.storageKey,
            status: contentAssetTable.status,
            generationLeaseExpiresAt: contentAssetTable.generationLeaseExpiresAt,
          })
          .from(contentAssetTable)
          .where(inArray(contentAssetTable.partId, partIds));

  // Filter to audio_* kinds in JS — keeps the SQL simple and avoids kind enum drift.
  const audioAssets = assets.filter((asset) => asset.kind.startsWith('audio_') && asset.partId);
  const assetByPartKind = new Map(
    audioAssets.map((asset) => [assetPartKindKey(asset.partId!, asset.kind), asset as AudioAssetRow]),
  );

  const chapterKeys = [
    ...new Set(
      [
        ...segmentObjects.map((object) => siblingChapterKeyForSegment(object.key)),
        ...audioAssets.map((a) => a.storageKey),
      ].filter((key): key is string => Boolean(key)),
    ),
  ];
  const chapterExistsByKey = new Map<string, boolean>();
  for (const key of chapterKeys) {
    chapterExistsByKey.set(key, await objectExists(key));
  }

  const decisions = segmentObjects.map((object) =>
    evaluateLegacySegmentCandidate({
      object,
      referencedKeys: referenced.keys,
      assetByPartKind,
      chapterExistsByKey,
    }),
  );

  const eligible = decisions.filter(
    (decision): decision is Extract<LegacySegmentDecision, { eligible: true }> => decision.eligible,
  );
  const skipped = decisions
    .filter((decision): decision is Extract<LegacySegmentDecision, { eligible: false }> => !decision.eligible)
    .map((decision) => ({
      key: decision.key,
      reason: decision.reason,
      detail: decision.detail,
    }));

  const manifest: LegacySegmentCleanupManifest = {
    createdAt,
    mode: execute ? 'execute' : 'dry-run',
    scanComplete: listed.complete,
    listedSegmentCount: segmentObjects.length,
    referencedSkippedCount: skipped.filter((entry) => entry.reason === 'still_referenced').length,
    eligibleKeys: eligible.map((entry) => entry.key),
    skipped,
    deletedKeys: [],
    failed: [],
  };

  if (!execute) {
    const written = await writeLegacyCleanupManifest(manifest, options.manifestPath);
    logger.info(
      {
        mode: 'dry-run',
        eligibleCount: manifest.eligibleKeys.length,
        skippedCount: manifest.skipped.length,
        scanComplete: manifest.scanComplete,
        manifestPath: written,
      },
      'Legacy segment cleanup dry-run finished',
    );
    return { manifest, manifestPath: written };
  }

  if (!listed.complete) {
    manifest.failed.push({
      key: '*',
      error:
        'Incomplete object listing; refusing execute. Re-run with a smaller bucket or higher limit after confirming coverage.',
    });
    const written = await writeLegacyCleanupManifest(manifest, options.manifestPath);
    return { manifest, manifestPath: written };
  }

  // Live revalidation before each batch — never delete from a stale dry-run list alone.
  let pending = [...manifest.eligibleKeys];
  while (pending.length > 0) {
    const batch = pending.slice(0, CLEANUP_BATCH_SIZE);
    pending = pending.slice(CLEANUP_BATCH_SIZE);
    const liveReferenced = await collectReferencedStorageKeys();
    const stillEligible: string[] = [];
    for (const key of batch) {
      if (liveReferenced.keys.has(key)) {
        manifest.skipped.push({ key, reason: 'still_referenced', detail: 'became referenced before delete' });
        continue;
      }
      stillEligible.push(key);
    }
    if (stillEligible.length === 0) continue;
    const deleted = await deleteManyObjects(stillEligible);
    manifest.deletedKeys.push(...deleted.deleted);
    for (const failure of deleted.failed) {
      manifest.failed.push({ key: failure.key, error: failure.error });
    }
  }

  const written = await writeLegacyCleanupManifest(manifest, options.manifestPath);
  logger.info(
    {
      mode: 'execute',
      deletedCount: manifest.deletedKeys.length,
      failedCount: manifest.failed.length,
      eligibleCount: manifest.eligibleKeys.length,
      manifestPath: written,
    },
    'Legacy segment cleanup execute finished',
  );
  return { manifest, manifestPath: written };
}

export async function writeLegacyCleanupManifest(
  manifest: LegacySegmentCleanupManifest,
  manifestPath?: string,
): Promise<string> {
  const target =
    manifestPath ??
    path.join(process.cwd(), 'tmp', `legacy-audio-segment-cleanup-${manifest.createdAt.replace(/[:.]/g, '-')}.json`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return target;
}
