import { eq, isNotNull } from 'drizzle-orm';

import { contentAsset as contentAssetTable, readingWork as readingWorkTable } from '@gloaming/db';
import { isAdminRole } from '@gloaming/shared/auth';

import type { AuthSessionUser } from '@/infra/auth/auth';
import { db } from '@/infra/db';
import type { ObjectGetStreamResult, ObjectRange } from '@/infra/storage';
import { getObjectStream } from '@/infra/storage';

export type AssetViewer = 'admin' | 'user' | 'anonymous';

/**
 * Unified asset gateway — the single entry for every object-storage read
 * (images, covers, TTS audio, origin files, future derivatives). New asset
 * kinds only register here; never open another proxy route.
 */

/** Asset kinds served to the public once the owning work is published. */
function isPublicAssetKind(kind: string): boolean {
  return kind === 'image' || kind === 'cover' || kind.startsWith('audio_');
}

/** Only published learner-facing assets may use shared public caching. */
export function isPublicAsset(asset: Pick<ResolvedAsset, 'kind' | 'isPublished'>): boolean {
  return asset.isPublished && isPublicAssetKind(asset.kind);
}

export function resolveAssetViewer(user: AuthSessionUser | null): AssetViewer {
  if (!user) {
    return 'anonymous';
  }
  return isAdminRole(user.role) ? 'admin' : 'user';
}

export type ResolvedAsset = {
  assetId: string;
  workId: string;
  kind: string;
  storageKey: string;
  mimeType: string;
  isPublished: boolean;
};

/** Look up an asset row + owning work publication state (assetId → storageKey, never key from caller). */
export async function resolveAsset(assetId: string): Promise<ResolvedAsset | null> {
  const [row] = await db
    .select({
      id: contentAssetTable.id,
      workId: contentAssetTable.workId,
      kind: contentAssetTable.kind,
      storageKey: contentAssetTable.storageKey,
      mimeType: contentAssetTable.mimeType,
      isPublished: isNotNull(readingWorkTable.publishedAt),
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
    workId: row.workId ?? '',
    kind: row.kind,
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    isPublished: Boolean(row.isPublished),
  };
}

/** Authorization matrix — admin may read anything; others only published public kinds. */
export function isAssetAuthorized(viewer: AssetViewer, asset: ResolvedAsset): boolean {
  if (viewer === 'admin') {
    return true;
  }
  return isPublicAsset(asset);
}

export async function streamAsset(asset: ResolvedAsset, range?: ObjectRange): Promise<ObjectGetStreamResult | null> {
  return getObjectStream(asset.storageKey, range);
}
