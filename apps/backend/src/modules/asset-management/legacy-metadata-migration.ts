import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { and, eq, isNull, lte, ne, or } from 'drizzle-orm';

import { contentAsset as contentAssetTable, type ContentAssetMeta } from '@gloaming/db';
import { isLegacyAudioSegmentKey } from '@gloaming/shared/assets';

import { db } from '@/db';
import { formalAudioObjectKeys } from '@/modules/content-assets/service';

import {
  computeMetadataMigrationFingerprint,
  LEGACY_METADATA_MIGRATION_SCHEMA_VERSION,
  LEGACY_METADATA_MIGRATION_TOOL_VERSION,
  type LegacyMetadataMigrationCandidate,
  type LegacyMetadataMigrationManifest,
  validateApprovedMetadataMigrationManifest,
} from './legacy-metadata-migration-guards.ts';

export type { LegacyMetadataMigrationCandidate, LegacyMetadataMigrationManifest };

type ContentAssetRow = typeof contentAssetTable.$inferSelect;

export function metadataHash(meta: ContentAssetMeta): string {
  return createHash('sha256').update(JSON.stringify(meta), 'utf8').digest('hex');
}

export function isActiveGeneration(row: ContentAssetRow, now = new Date()): boolean {
  if (row.status !== 'generating') return false;
  if (!row.generationLeaseExpiresAt) return true;
  return row.generationLeaseExpiresAt.getTime() > now.getTime();
}

function countLegacyTimelineKeys(meta: ContentAssetMeta): string[] {
  const keys: string[] = [];
  for (const segment of meta.timeline ?? []) {
    const key = segment.storageKey;
    if (key && isLegacyAudioSegmentKey(key)) {
      keys.push(key);
    }
  }
  return keys;
}

function hasNonLegacyTimelineStorageKey(meta: ContentAssetMeta): string | null {
  for (const segment of meta.timeline ?? []) {
    const key = segment.storageKey;
    if (!key) continue;
    if (!isLegacyAudioSegmentKey(key)) {
      return key;
    }
  }
  return null;
}

/** Pure migration transform: only strips legacy segment references. */
export function computeMigratedAudioMetadata(row: Pick<ContentAssetRow, 'storageKey' | 'meta'>): ContentAssetMeta {
  const meta = row.meta ?? {};
  return {
    ...meta,
    objectKeys: formalAudioObjectKeys({ storageKey: row.storageKey, meta }),
    timeline: (meta.timeline ?? []).map((segment) => {
      const key = segment.storageKey;
      if (!key || !isLegacyAudioSegmentKey(key)) {
        return segment;
      }
      const { storageKey: _removed, ...timing } = segment;
      return timing;
    }),
  };
}

export function buildMetadataMigrationCandidate(row: ContentAssetRow): LegacyMetadataMigrationCandidate | null {
  const meta = row.meta ?? {};
  const removedObjectKeys = (meta.objectKeys ?? []).filter((key) => isLegacyAudioSegmentKey(key));
  const removedTimelineKeys = countLegacyTimelineKeys(meta);
  if (removedObjectKeys.length === 0 && removedTimelineKeys.length === 0) {
    return null;
  }

  const unsafeTimelineKey = hasNonLegacyTimelineStorageKey(meta);
  if (unsafeTimelineKey) {
    return null;
  }

  const nextMeta = computeMigratedAudioMetadata(row);

  return {
    assetId: row.id,
    workId: row.workId,
    partId: row.partId,
    kind: row.kind,
    storageKey: row.storageKey,
    contentHash: row.contentHash,
    status: row.status,
    generationKey: row.generationKey,
    generationToken: row.generationToken,
    generationLeaseExpiresAt: row.generationLeaseExpiresAt?.toISOString() ?? null,
    chapterKey: row.storageKey,
    removedObjectKeys,
    removedTimelineKeys,
    removedObjectKeyCount: removedObjectKeys.length,
    removedTimelineKeyCount: removedTimelineKeys.length,
    beforeMetadataHash: metadataHash(meta),
    afterMetadataHash: metadataHash(nextMeta),
  };
}

export function buildMetadataMigrationSkipReason(row: ContentAssetRow): { assetId: string; reason: string } | null {
  const meta = row.meta ?? {};
  const removedObjectKeys = (meta.objectKeys ?? []).filter((key) => isLegacyAudioSegmentKey(key));
  const removedTimelineKeys = countLegacyTimelineKeys(meta);
  if (removedObjectKeys.length === 0 && removedTimelineKeys.length === 0) {
    return null;
  }
  const unsafeTimelineKey = hasNonLegacyTimelineStorageKey(meta);
  if (unsafeTimelineKey) {
    return { assetId: row.id, reason: `non_legacy_timeline_storage_key:${unsafeTimelineKey}` };
  }
  return null;
}

function candidateMatchesRow(candidate: LegacyMetadataMigrationCandidate, row: ContentAssetRow): string | null {
  if (metadataHash(row.meta ?? {}) !== candidate.beforeMetadataHash) {
    return 'metadata_hash_changed';
  }
  if (row.contentHash !== candidate.contentHash) {
    return 'content_hash_changed';
  }
  if (row.storageKey !== candidate.storageKey) {
    return 'storage_key_changed';
  }
  if (row.status !== candidate.status) {
    return 'status_changed';
  }
  if (row.generationKey !== candidate.generationKey) {
    return 'generation_key_changed';
  }
  if (row.generationToken !== candidate.generationToken) {
    return 'generation_token_changed';
  }
  const leaseIso = row.generationLeaseExpiresAt?.toISOString() ?? null;
  if (leaseIso !== candidate.generationLeaseExpiresAt) {
    return 'generation_lease_changed';
  }
  if (isActiveGeneration(row)) {
    return 'active_generation_in_progress';
  }
  return null;
}

async function loadApprovedManifest(manifestPath: string): Promise<LegacyMetadataMigrationManifest> {
  const raw = await readFile(manifestPath, 'utf8');
  return JSON.parse(raw) as LegacyMetadataMigrationManifest;
}

export async function writeMetadataMigrationManifest(
  manifest: LegacyMetadataMigrationManifest,
  manifestPath?: string,
): Promise<string> {
  const target =
    manifestPath ??
    path.join(process.cwd(), 'tmp', `legacy-audio-metadata-migration-${manifest.createdAt.replace(/[:.]/g, '-')}.json`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return target;
}

async function scanMigrationCandidates(): Promise<{
  candidates: LegacyMetadataMigrationCandidate[];
  skipped: Array<{ assetId: string; reason: string }>;
}> {
  const rows = await db
    .select()
    .from(contentAssetTable)
    .where(or(eq(contentAssetTable.kind, 'audio_us'), eq(contentAssetTable.kind, 'audio_uk')));

  const candidates: LegacyMetadataMigrationCandidate[] = [];
  const skipped: Array<{ assetId: string; reason: string }> = [];
  for (const row of rows) {
    const skipReason = buildMetadataMigrationSkipReason(row);
    if (skipReason) {
      skipped.push(skipReason);
      continue;
    }
    const candidate = buildMetadataMigrationCandidate(row);
    if (candidate) {
      candidates.push(candidate);
    }
  }
  return { candidates, skipped };
}

function summarizeRemovedKeys(candidates: LegacyMetadataMigrationCandidate[]): {
  removedObjectKeyCount: number;
  removedTimelineKeyCount: number;
} {
  return {
    removedObjectKeyCount: candidates.reduce((sum, candidate) => sum + candidate.removedObjectKeyCount, 0),
    removedTimelineKeyCount: candidates.reduce((sum, candidate) => sum + candidate.removedTimelineKeyCount, 0),
  };
}

export async function runLegacyMetadataMigrationDryRun(options: {
  databaseName: string;
  manifestPath?: string;
}): Promise<{ manifest: LegacyMetadataMigrationManifest; manifestPath: string }> {
  const { candidates, skipped } = await scanMigrationCandidates();
  const removed = summarizeRemovedKeys(candidates);
  const createdAt = new Date().toISOString();
  const manifest: LegacyMetadataMigrationManifest = {
    schemaVersion: LEGACY_METADATA_MIGRATION_SCHEMA_VERSION,
    toolVersion: LEGACY_METADATA_MIGRATION_TOOL_VERSION,
    createdAt,
    mode: 'dry-run',
    databaseName: options.databaseName,
    candidateCount: candidates.length,
    fingerprint: computeMetadataMigrationFingerprint(candidates),
    removedObjectKeyCount: removed.removedObjectKeyCount,
    removedTimelineKeyCount: removed.removedTimelineKeyCount,
    candidates,
    updatedAssetIds: [],
    skipped,
    conflicts: [],
    failed: [],
    remainingLegacyReferences: 0,
  };
  const written = await writeMetadataMigrationManifest(manifest, options.manifestPath);
  return { manifest, manifestPath: written };
}

async function countRemainingLegacyReferences(): Promise<number> {
  const rows = await db
    .select({ meta: contentAssetTable.meta })
    .from(contentAssetTable)
    .where(or(eq(contentAssetTable.kind, 'audio_us'), eq(contentAssetTable.kind, 'audio_uk')));
  let count = 0;
  for (const row of rows) {
    const meta = row.meta ?? {};
    count += (meta.objectKeys ?? []).filter((key) => isLegacyAudioSegmentKey(key)).length;
    count += countLegacyTimelineKeys(meta).length;
  }
  return count;
}

export async function runLegacyMetadataMigrationExecute(options: {
  approvedManifestPath: string;
  databaseName: string;
  outputPath?: string;
}): Promise<{ manifest: LegacyMetadataMigrationManifest; manifestPath: string }> {
  const approved = await loadApprovedManifest(options.approvedManifestPath);
  validateApprovedMetadataMigrationManifest(approved, options.databaseName);

  const createdAt = new Date().toISOString();
  const manifest: LegacyMetadataMigrationManifest = {
    ...approved,
    createdAt,
    mode: 'execute',
    updatedAssetIds: [],
    skipped: [...approved.skipped],
    conflicts: [],
    failed: [],
    remainingLegacyReferences: 0,
  };

  const now = new Date();
  for (const candidate of approved.candidates) {
    try {
      const [current] = await db
        .select()
        .from(contentAssetTable)
        .where(eq(contentAssetTable.id, candidate.assetId))
        .limit(1);
      if (!current) {
        manifest.failed.push({ assetId: candidate.assetId, error: 'asset_missing_at_execute' });
        continue;
      }

      const mismatch = candidateMatchesRow(candidate, current);
      if (mismatch) {
        manifest.conflicts.push({ assetId: candidate.assetId, reason: mismatch });
        continue;
      }

      const nextMeta = computeMigratedAudioMetadata(current);
      const [updated] = await db
        .update(contentAssetTable)
        .set({ meta: nextMeta })
        .where(
          and(
            eq(contentAssetTable.id, candidate.assetId),
            eq(contentAssetTable.contentHash, candidate.contentHash),
            eq(contentAssetTable.storageKey, candidate.storageKey),
            eq(contentAssetTable.status, candidate.status),
            candidate.generationKey
              ? eq(contentAssetTable.generationKey, candidate.generationKey)
              : isNull(contentAssetTable.generationKey),
            candidate.generationToken
              ? eq(contentAssetTable.generationToken, candidate.generationToken)
              : isNull(contentAssetTable.generationToken),
            candidate.generationLeaseExpiresAt
              ? eq(contentAssetTable.generationLeaseExpiresAt, new Date(candidate.generationLeaseExpiresAt))
              : isNull(contentAssetTable.generationLeaseExpiresAt),
            or(
              ne(contentAssetTable.status, 'generating'),
              isNull(contentAssetTable.generationLeaseExpiresAt),
              lte(contentAssetTable.generationLeaseExpiresAt, now),
            ),
          ),
        )
        .returning({ id: contentAssetTable.id });

      if (!updated) {
        manifest.conflicts.push({ assetId: candidate.assetId, reason: 'cas_update_rejected' });
        continue;
      }
      manifest.updatedAssetIds.push(updated.id);
    } catch (error) {
      manifest.failed.push({
        assetId: candidate.assetId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  manifest.remainingLegacyReferences = await countRemainingLegacyReferences();
  const written = await writeMetadataMigrationManifest(manifest, options.outputPath ?? options.approvedManifestPath);
  return { manifest, manifestPath: written };
}

export async function runLegacyMetadataMigration(options: {
  execute?: boolean;
  databaseName: string;
  manifestPath?: string;
  outputPath?: string;
}): Promise<{ manifest: LegacyMetadataMigrationManifest; manifestPath: string }> {
  if (options.execute) {
    if (!options.manifestPath) {
      throw new Error('Refusing --execute without --manifest <approved-dry-run-manifest>');
    }
    return runLegacyMetadataMigrationExecute({
      approvedManifestPath: options.manifestPath,
      databaseName: options.databaseName,
      outputPath: options.outputPath,
    });
  }
  return runLegacyMetadataMigrationDryRun({
    databaseName: options.databaseName,
    manifestPath: options.manifestPath,
  });
}
