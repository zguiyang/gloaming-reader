import { eq } from 'drizzle-orm';

import { contentAsset as contentAssetTable, readingWork as readingWorkTable } from '@gloaming/db';

import type { WorkReadActor } from '@/domains/works/access';
import { canReadWorkRow, isPublicCatalogWork, isWorkReadAdmin } from '@/domains/works/access';
import { db } from '@/infra/db';
import type { ObjectGetStreamResult, ObjectRange } from '@/infra/storage';
import { getObjectStream } from '@/infra/storage';

/**
 * Unified asset gateway — the single entry for every object-storage read
 * (images, covers, TTS audio, origin files, future derivatives). New asset
 * kinds only register here; never open another proxy route.
 */

/** Asset kinds served to learners once the owning work is readable. */
function isPublicAssetKind(kind: string): boolean {
  return kind === 'image' || kind === 'cover' || kind.startsWith('audio_');
}

export type ResolvedAsset = {
  assetId: string;
  workId: string | null;
  kind: string;
  storageKey: string;
  mimeType: string;
  ownerUserId: string | null;
  visibility: string;
  publishedAt: Date | null;
};

/** Only anonymous-readable catalog work assets may use shared public caching. */
export function isPublicAsset(asset: ResolvedAsset): boolean {
  return isPublicAssetKind(asset.kind) && isPublicCatalogWork(asset);
}

/** Look up an asset row + owning work fields (assetId → storageKey, never key from caller). */
export async function resolveAsset(assetId: string): Promise<ResolvedAsset | null> {
  const [row] = await db
    .select({
      id: contentAssetTable.id,
      workId: contentAssetTable.workId,
      kind: contentAssetTable.kind,
      storageKey: contentAssetTable.storageKey,
      mimeType: contentAssetTable.mimeType,
      ownerUserId: readingWorkTable.ownerUserId,
      visibility: readingWorkTable.visibility,
      publishedAt: readingWorkTable.publishedAt,
    })
    .from(contentAssetTable)
    .leftJoin(readingWorkTable, eq(contentAssetTable.workId, readingWorkTable.id))
    .where(eq(contentAssetTable.id, assetId))
    .limit(1);
  if (!row || !row.storageKey) {
    return null;
  }
  return {
    assetId: row.id,
    workId: row.workId ?? null,
    kind: row.kind,
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    ownerUserId: row.ownerUserId,
    visibility: row.visibility ?? 'catalog',
    publishedAt: row.publishedAt,
  };
}

/** Authorization matrix — admin any asset; work owners all kinds; others public catalog kinds only. */
export function isAssetAuthorized(actor: WorkReadActor, asset: ResolvedAsset): boolean {
  if (isWorkReadAdmin(actor)) {
    return true;
  }
  if (asset.workId == null) {
    return false;
  }
  if (!canReadWorkRow(actor, asset)) {
    return false;
  }
  if (actor.userId != null && asset.ownerUserId === actor.userId) {
    return true;
  }
  return isPublicAssetKind(asset.kind);
}

export async function streamAsset(asset: ResolvedAsset, range?: ObjectRange): Promise<ObjectGetStreamResult | null> {
  return getObjectStream(asset.storageKey, range);
}
