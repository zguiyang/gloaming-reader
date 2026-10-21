import {
  contentAsset as contentAssetTable,
  type ContentAssetMeta,
  partAudioSegment as partAudioSegmentTable,
  readingWork as readingWorkTable,
  uploadedObject as uploadedObjectTable,
} from '@gloaming/db';

import { db } from '@/infra/db';

/**
 * ContentAsset kinds whose stored objects are reference-protected. Legacy
 * `audio_*` rows are deliberately absent: they are retired and no longer read,
 * and their objects may be reclaimed by the orphan-cleanup job.
 */
const PROTECTED_ASSET_KINDS = new Set(['cover', 'image', 'origin_file']);

type ParseArtifactManifest = {
  attemptToken: string;
  keys: string[];
};

export type ReferencedKeyIndex = {
  /** Formal cover, image, and origin-file objects, plus live reader-audio segment objects. */
  formalKeys: Set<string>;
  /** Keys from uploaded_object, workflow artifacts, and other external sources. */
  externalReferencedKeys: Set<string>;
  /** Union of all reference sources. */
  allReferencedKeys: Set<string>;
  kindByKey: Map<string, string>;
};

export function createEmptyReferencedKeyIndex(): ReferencedKeyIndex {
  return {
    formalKeys: new Set(),
    externalReferencedKeys: new Set(),
    allReferencedKeys: new Set(),
    kindByKey: new Map(),
  };
}

/** Test helper — treats every key as a formal reference unless marked external. */
export function referencedKeyIndexFromKeys(
  keys: string[],
  options: { kinds?: Record<string, string>; external?: string[] } = {},
): ReferencedKeyIndex {
  const index = createEmptyReferencedKeyIndex();
  const externalSet = new Set(options.external ?? []);
  for (const key of keys) {
    if (externalSet.has(key)) {
      addExternalReferencedKey(index, key);
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
    if (!PROTECTED_ASSET_KINDS.has(asset.kind)) continue;
    const meta = asset.meta as ContentAssetMeta;
    for (const key of new Set([asset.storageKey, ...(meta.objectKeys ?? [])])) {
      addFormalReferencedKey(index, key, asset.kind);
    }
  }

  // Live lazy reader-audio segments are protected until their rows cascade
  // away (ingest reset and personal-work deletion collect their objects).
  const segments = await db.select({ storageKey: partAudioSegmentTable.storageKey }).from(partAudioSegmentTable);
  for (const row of segments) {
    addFormalReferencedKey(index, row.storageKey);
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
  return [
    ...new Set([asset.storageKey, ...(asset.meta.objectKeys ?? [])].filter((key): key is string => Boolean(key))),
  ];
}

export function collectKeysFromOriginMeta(originMeta: unknown): string[] {
  return parseArtifactManifests(originMeta).flatMap((manifest) => manifest.keys);
}
