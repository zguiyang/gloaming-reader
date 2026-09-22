import { and, eq } from 'drizzle-orm';

import { contentAsset as contentAssetTable } from '@gloaming/db';
import { audioKindForRole, buildContentAssetGenerationKey } from '@gloaming/shared/content-assets';
import { type TtsVoiceRole } from '@gloaming/shared/tts';

import { formalAudioObjectKeys } from '@/domains/assets/audio/keys';
import { loadPart } from '@/domains/assets/content/part-access';
import { type AssetRow } from '@/domains/assets/content/track-view';
import { hashPartAudioContent } from '@/domains/works/content';
import { db } from '@/infra/db';
import { rootLogger } from '@/infra/logging/logger';
import { objectExists } from '@/infra/storage';

const partAudioLogger = rootLogger.child({ module: 'ContentAssets' });

/** Admin/enqueue only (`needsRegen`) — not used on the learner read path. */
async function objectsExistForAsset(asset: AssetRow): Promise<boolean> {
  const keys = formalAudioObjectKeys(asset);
  if (keys.length === 0) {
    return false;
  }
  for (const key of keys) {
    try {
      if (!(await objectExists(key))) {
        return false;
      }
    } catch (error) {
      partAudioLogger.warn({ err: error, key }, 'Object storage exists check failed');
      return false;
    }
  }
  return true;
}

export async function needsRegen(partId: string, role: TtsVoiceRole, contentHash: string): Promise<boolean> {
  const kind = audioKindForRole(role);
  const generationKey = buildContentAssetGenerationKey({ partId, kind, contentHash });
  const [asset] = await db
    .select()
    .from(contentAssetTable)
    .where(and(eq(contentAssetTable.partId, partId), eq(contentAssetTable.kind, kind)))
    .limit(1);
  if (!asset) {
    return true;
  }
  if (
    asset.status === 'generating' &&
    asset.generationKey === generationKey &&
    asset.generationLeaseExpiresAt &&
    asset.generationLeaseExpiresAt > new Date()
  ) {
    return false;
  }
  if (asset.status === 'failed') {
    return true;
  }
  if (asset.status !== 'ready' || asset.contentHash !== contentHash) {
    return true;
  }
  return !(await objectsExistForAsset(asset));
}

export type PartAudioAvailability = { us: boolean; uk: boolean };

/** DB-only: ready + content hash match. Object presence is verified on GetObject. */
async function isTrackPlayable(
  part: { title: string; body: string },
  partId: string,
  role: TtsVoiceRole,
): Promise<boolean> {
  const sourceHash = hashPartAudioContent(part.body);
  const kind = audioKindForRole(role);
  const [asset] = await db
    .select()
    .from(contentAssetTable)
    .where(and(eq(contentAssetTable.partId, partId), eq(contentAssetTable.kind, kind)))
    .limit(1);
  return Boolean(asset && asset.status === 'ready' && asset.contentHash === sourceHash);
}

export async function getPartAudioAvailability(
  partId: string,
  title?: string,
  body?: string,
): Promise<PartAudioAvailability> {
  const part = title !== undefined && body !== undefined ? { title, body } : await loadPart(partId);
  const [us, uk] = await Promise.all([isTrackPlayable(part, partId, 'us'), isTrackPlayable(part, partId, 'uk')]);
  return { us, uk };
}
