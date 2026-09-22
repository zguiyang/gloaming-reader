import { type ContentAssetMeta } from '@gloaming/db';

import { allAudioObjectKeysForLegacyCleanup } from '@/domains/assets/audio/keys';
import { rootLogger } from '@/infra/logging/logger';
import { deleteObject } from '@/infra/storage';

const partAudioLogger = rootLogger.child({ module: 'ContentAssets' });

async function deleteObjectKeys(keys: string[], context: Record<string, unknown>): Promise<void> {
  for (const key of keys) {
    try {
      await deleteObject(key);
    } catch (error) {
      partAudioLogger.warn({ err: error, key, ...context }, 'Failed to delete audio object');
    }
  }
}

function audioObjectKeys(asset: { storageKey: string | null; meta: ContentAssetMeta }): string[] {
  return allAudioObjectKeysForLegacyCleanup(asset);
}

export async function deleteAudioAssetObjects(asset: {
  kind: string;
  storageKey: string;
  meta: ContentAssetMeta;
}): Promise<void> {
  if (!asset.kind.startsWith('audio_')) {
    await deleteObject(asset.storageKey);
    return;
  }
  await deleteObjectKeys(audioObjectKeys(asset), { kind: asset.kind });
}
