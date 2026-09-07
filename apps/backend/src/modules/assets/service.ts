import { eq } from 'drizzle-orm';

import { contentAsset as contentAssetTable, readingWork as readingWorkTable } from '@gloaming/db';
import { isAdminRole } from '@gloaming/shared/auth';

import { db } from '@/db';
import type { AuthSessionUser } from '@/lib/auth';
import type { ObjectGetStreamResult, ObjectRange } from '@/lib/oss';
import { getObjectStream } from '@/modules/oss';

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
  workStatus: string;
};

/** Look up an asset row + owning work status (assetId → storageKey, never key from caller). */
export async function resolveAsset(assetId: string): Promise<ResolvedAsset | null> {
  const [row] = await db
    .select({
      id: contentAssetTable.id,
      workId: contentAssetTable.workId,
      kind: contentAssetTable.kind,
      storageKey: contentAssetTable.storageKey,
      mimeType: contentAssetTable.mimeType,
      workStatus: readingWorkTable.status,
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
    workStatus: row.workStatus ?? 'processing',
  };
}

/** Authorization matrix — admin may read anything; others only published public kinds. */
export function isAssetAuthorized(viewer: AssetViewer, asset: ResolvedAsset): boolean {
  if (viewer === 'admin') {
    return true;
  }
  if (asset.workStatus !== 'published') {
    return false;
  }
  return isPublicAssetKind(asset.kind);
}

export async function streamAsset(asset: ResolvedAsset, range?: ObjectRange): Promise<ObjectGetStreamResult | null> {
  return getObjectStream(asset.storageKey, range);
}
