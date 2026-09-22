import { type ContentAssetMeta } from '@gloaming/db';
import { isLegacyAudioSegmentKey } from '@gloaming/shared/assets';

export function partAudioChapterKey(partId: string, kind: string, contentHash: string): string {
  return `part-audio/${partId}/${kind}/${contentHash}/chapter.mp3`;
}

export function partAudioSegmentKey(partId: string, kind: string, contentHash: string, index: number): string {
  return `part-audio/${partId}/${kind}/${contentHash}/seg/${String(index).padStart(4, '0')}.mp3`;
}

/** Alias for chapter key — tests and callers that used the old single-file path. */
export function partAudioObjectKey(partId: string, kind: string, contentHash: string): string {
  return partAudioChapterKey(partId, kind, contentHash);
}

/**
 * Formal stored objects for needsRegen, ready checks, and asset integrity.
 * Excludes legacy segment keys that may still appear in historical meta.objectKeys.
 */
export function formalAudioObjectKeys(asset: { storageKey: string | null; meta: ContentAssetMeta }): string[] {
  const keys = [asset.storageKey, ...(asset.meta.objectKeys ?? []).filter((key) => !isLegacyAudioSegmentKey(key))];
  return [...new Set(keys.filter((key): key is string => Boolean(key)))];
}

/**
 * All object keys referenced by audio metadata, including historical segments.
 * Used for legacy cleanup and deleting obsolete audio assets.
 */
export function allAudioObjectKeysForLegacyCleanup(asset: {
  storageKey: string | null;
  meta: ContentAssetMeta;
}): string[] {
  const keys = [
    asset.storageKey,
    ...(asset.meta.objectKeys ?? []),
    ...(asset.meta.timeline ?? []).map((segment) => segment.storageKey),
  ];
  return [...new Set(keys.filter((key): key is string => Boolean(key)))];
}

/** Segment keys still recorded in legacy audio metadata (objectKeys or timeline.storageKey). */
export function collectLegacyAudioSegmentKeysFromAsset(asset: { meta: ContentAssetMeta }): string[] {
  const keys: string[] = [];
  for (const key of asset.meta.objectKeys ?? []) {
    if (isLegacyAudioSegmentKey(key)) {
      keys.push(key);
    }
  }
  for (const segment of asset.meta.timeline ?? []) {
    if (segment.storageKey && isLegacyAudioSegmentKey(segment.storageKey)) {
      keys.push(segment.storageKey);
    }
  }
  return [...new Set(keys)];
}
