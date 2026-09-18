import {
  contentAsset as contentAssetTable,
  type ContentAssetMeta,
  readingWork as readingWorkTable,
  uploadedObject as uploadedObjectTable,
} from '@gloaming/db';
import { isLegacyAudioSegmentKey } from '@gloaming/shared/assets';

import { db } from '@/db';
import { collectLegacyAudioSegmentKeysFromAsset, formalAudioObjectKeys } from '@/modules/content-assets/audio/keys';

type ParseArtifactManifest = {
  attemptToken: string;
  keys: string[];
};

export type ReferencedKeyIndex = {
  /** Formal chapter, cover, image, origin, and non-segment audio objects. */
  formalKeys: Set<string>;
  /** Segment keys referenced only via legacy audio metadata fields. */
  legacyAudioSegmentKeys: Set<string>;
  /** Keys from uploaded_object, workflow artifacts, and other non-audio sources. */
  externalReferencedKeys: Set<string>;
  /** Union of all reference sources. */
  allReferencedKeys: Set<string>;
  kindByKey: Map<string, string>;
};

export function createEmptyReferencedKeyIndex(): ReferencedKeyIndex {
  return {
    formalKeys: new Set(),
    legacyAudioSegmentKeys: new Set(),
    externalReferencedKeys: new Set(),
    allReferencedKeys: new Set(),
    kindByKey: new Map(),
  };
}

/** Test helper — treats every key as a formal reference unless marked legacy/external. */
export function referencedKeyIndexFromKeys(
  keys: string[],
  options: { kinds?: Record<string, string>; legacySegments?: string[]; external?: string[] } = {},
): ReferencedKeyIndex {
  const index = createEmptyReferencedKeyIndex();
  const legacySet = new Set(options.legacySegments ?? []);
  const externalSet = new Set(options.external ?? []);
  for (const key of keys) {
    if (externalSet.has(key)) {
      addExternalReferencedKey(index, key);
      continue;
    }
    if (legacySet.has(key) || isLegacyAudioSegmentKey(key)) {
      addLegacyAudioSegmentKey(index, key);
      continue;
    }
    addFormalReferencedKey(index, key, options.kinds?.[key]);
  }
  return index;
}

function addFormalReferencedKey(index: ReferencedKeyIndex, key: string | null | undefined, kind?: string | null): void {
  if (!key) return;
  index.formalKeys.add(key);
  index.allReferencedKeys.add(key);
  if (kind && !index.kindByKey.has(key)) {
    index.kindByKey.set(key, kind);
  }
}

function addLegacyAudioSegmentKey(index: ReferencedKeyIndex, key: string | null | undefined): void {
  if (!key) return;
  index.legacyAudioSegmentKeys.add(key);
  index.allReferencedKeys.add(key);
}

function addExternalReferencedKey(index: ReferencedKeyIndex, key: string | null | undefined): void {
  if (!key) return;
  index.externalReferencedKeys.add(key);
  index.allReferencedKeys.add(key);
}

function parseArtifactManifests(originMeta: unknown): ParseArtifactManifest[] {
  if (!originMeta || typeof originMeta !== 'object') return [];
  const value = (originMeta as Record<string, unknown>).workflowParseArtifacts;
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const candidate = entry as { attemptToken?: unknown; keys?: unknown };
    if (
      typeof candidate.attemptToken !== 'string' ||
      !Array.isArray(candidate.keys) ||
      !candidate.keys.every((key): key is string => typeof key === 'string')
    ) {
      return [];
    }
    return [{ attemptToken: candidate.attemptToken, keys: candidate.keys }];
  });
}

/** Collect every storage key currently referenced by database rows. */
export async function collectReferencedStorageKeys(): Promise<ReferencedKeyIndex> {
  const index = createEmptyReferencedKeyIndex();

  const assets = await db
    .select({
      storageKey: contentAssetTable.storageKey,
      kind: contentAssetTable.kind,
      meta: contentAssetTable.meta,
    })
    .from(contentAssetTable);

  for (const asset of assets) {
    const meta = asset.meta as ContentAssetMeta;
    if (asset.kind.startsWith('audio_')) {
      for (const key of formalAudioObjectKeys({ storageKey: asset.storageKey, meta })) {
        addFormalReferencedKey(index, key, asset.kind);
      }
      for (const key of collectLegacyAudioSegmentKeysFromAsset({ meta })) {
        addLegacyAudioSegmentKey(index, key);
      }
      continue;
    }
    addFormalReferencedKey(index, asset.storageKey, asset.kind);
    for (const key of meta.objectKeys ?? []) {
      addFormalReferencedKey(index, key, asset.kind);
    }
  }

  const uploaded = await db.select({ storageKey: uploadedObjectTable.storageKey }).from(uploadedObjectTable);
  for (const row of uploaded) {
    addExternalReferencedKey(index, row.storageKey);
  }

  const works = await db.select({ originMeta: readingWorkTable.originMeta }).from(readingWorkTable);
  for (const work of works) {
    for (const manifest of parseArtifactManifests(work.originMeta)) {
      for (const key of manifest.keys) {
        addExternalReferencedKey(index, key);
      }
    }
  }

  return index;
}

/** Pure helper — formal keys from a content_asset-shaped row (unit-testable). */
export function collectFormalKeysFromContentAssetRow(asset: {
  storageKey: string;
  kind: string;
  meta: ContentAssetMeta;
}): string[] {
  if (asset.kind.startsWith('audio_')) {
    return formalAudioObjectKeys({ storageKey: asset.storageKey, meta: asset.meta });
  }
  return [asset.storageKey, ...(asset.meta.objectKeys ?? [])].filter((key): key is string => Boolean(key));
}

/** Pure helper — legacy segment keys from audio metadata (unit-testable). */
export function collectLegacySegmentKeysFromContentAssetRow(asset: { meta: ContentAssetMeta }): string[] {
  return collectLegacyAudioSegmentKeysFromAsset(asset);
}

export function collectKeysFromOriginMeta(originMeta: unknown): string[] {
  return parseArtifactManifests(originMeta).flatMap((manifest) => manifest.keys);
}
