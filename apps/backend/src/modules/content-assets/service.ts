import { and, asc, eq, inArray } from 'drizzle-orm';

import {
  contentAsset as contentAssetTable,
  type ContentAssetMeta,
  readingPart as readingPartTable,
  readingWork as readingWorkTable,
} from '@gloaming/db';
import {
  audioKindForRole,
  buildContentAssetGenerationKey,
  type ContentAssetTrack,
  deriveAudioTrackStatus,
  type PartAudioView,
  roleForAudioKind,
  type WorkAudioSummary,
  type WorkAudioView,
} from '@gloaming/shared/content-assets';
import { type ReaderAudioTrack } from '@gloaming/shared/reader';
import { type TtsVoiceRole } from '@gloaming/shared/tts';

import { db } from '@/db';
import { ERROR_CODES } from '@/lib/error-codes';
import { NotFoundError } from '@/lib/errors';
import { rootLogger } from '@/lib/logger';
import { deleteObject, objectExists } from '@/modules/oss';
import { hashPartAudioContent } from '@/modules/works/content-hash';

import { allAudioObjectKeysForLegacyCleanup, formalAudioObjectKeys } from './keys';

const partAudioLogger = rootLogger.child({ module: 'ContentAssets' });

type AssetRow = typeof contentAssetTable.$inferSelect;

function assetUrl(assetId: string): string {
  return `/api/assets/${assetId}`;
}

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

async function loadPart(partId: string): Promise<{
  id: string;
  workId: string;
  title: string;
  body: string;
  sortOrder: number;
}> {
  const rows = await db
    .select({
      id: readingPartTable.id,
      workId: readingPartTable.workId,
      title: readingPartTable.title,
      body: readingPartTable.body,
      sortOrder: readingPartTable.sortOrder,
    })
    .from(readingPartTable)
    .where(eq(readingPartTable.id, partId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.PART);
  }
  return row;
}

function emptyTrack(role: TtsVoiceRole): ContentAssetTrack {
  return {
    role,
    status: 'none',
    voice: null,
    contentHash: null,
    contentStale: false,
    mimeType: null,
    lastError: null,
    generatedAt: null,
    updatedAt: null,
    audioAvailable: false,
    assetId: null,
    audioUrl: null,
    durationMs: null,
  };
}

/** Azure / legacy meta may store fractional ms; client Zod schemas require ints. */
function intMs(n: number): number {
  return Math.round(n);
}

function timelineForApi(timeline: NonNullable<ContentAssetMeta['timeline']>): ContentAssetTrack['timeline'] {
  return timeline.map((seg) => ({
    ...seg,
    startMs: intMs(seg.startMs),
    durationMs: intMs(seg.durationMs),
    wordTimings: seg.wordTimings.map((w) => ({
      ...w,
      audioOffsetMs: intMs(w.audioOffsetMs),
      durationMs: intMs(w.durationMs),
    })),
  }));
}

function toTrack(role: TtsVoiceRole, currentContentHash: string, asset: AssetRow | null): ContentAssetTrack {
  if (!asset) {
    return emptyTrack(role);
  }

  const meta = asset.meta ?? {};
  const contentStale = asset.contentHash !== currentContentHash;
  const status = deriveAudioTrackStatus(asset, currentContentHash);
  const playable = status === 'ready';
  return {
    role,
    status,
    voice: meta.voice ?? null,
    contentHash: asset.contentHash,
    contentStale,
    mimeType: asset.mimeType,
    lastError: meta.lastError ?? null,
    generatedAt: meta.generatedAt ?? null,
    updatedAt: asset.updatedAt.toISOString(),
    audioAvailable: playable,
    assetId: playable ? asset.id : null,
    audioUrl: playable ? assetUrl(asset.id) : null,
    durationMs: meta.durationMs != null ? intMs(meta.durationMs) : null,
    timeline: playable && meta.timeline ? timelineForApi(meta.timeline) : undefined,
  };
}

export async function getPartAudio(partId: string): Promise<PartAudioView> {
  const part = await loadPart(partId);
  const currentContentHash = hashPartAudioContent(part.body);
  const metaRows = await db.select().from(contentAssetTable).where(eq(contentAssetTable.partId, partId));
  const metaByKind = new Map<string, AssetRow>();
  for (const row of metaRows) {
    if (row.kind === 'audio_us' || row.kind === 'audio_uk') {
      metaByKind.set(row.kind, row);
    }
  }

  return {
    partId: part.id,
    workId: part.workId,
    title: part.title,
    currentContentHash,
    tracks: {
      us: toTrack('us', currentContentHash, metaByKind.get('audio_us') ?? null),
      uk: toTrack('uk', currentContentHash, metaByKind.get('audio_uk') ?? null),
    },
  };
}

function summarize(tracks: ContentAssetTrack[]): WorkAudioSummary {
  const summary: WorkAudioSummary = {
    total: tracks.length,
    none: 0,
    generating: 0,
    ready: 0,
    stale: 0,
    failed: 0,
  };
  for (const track of tracks) {
    summary[track.status] += 1;
  }
  return summary;
}

export async function getWorkAudio(workId: string, role: TtsVoiceRole): Promise<WorkAudioView> {
  const [work] = await db
    .select({ id: readingWorkTable.id })
    .from(readingWorkTable)
    .where(eq(readingWorkTable.id, workId))
    .limit(1);
  if (!work) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
  }

  const parts = await db
    .select({
      id: readingPartTable.id,
      title: readingPartTable.title,
      body: readingPartTable.body,
      sortOrder: readingPartTable.sortOrder,
    })
    .from(readingPartTable)
    .where(eq(readingPartTable.workId, workId))
    .orderBy(asc(readingPartTable.sortOrder));

  const partIds = parts.map((p) => p.id);
  const kind = audioKindForRole(role);
  const assets =
    partIds.length === 0
      ? []
      : await db
          .select()
          .from(contentAssetTable)
          .where(and(inArray(contentAssetTable.partId, partIds), eq(contentAssetTable.kind, kind)));
  const byPart = new Map(assets.map((row) => [row.partId!, row]));

  const rows = parts.map((part) => {
    const currentContentHash = hashPartAudioContent(part.body);
    return {
      partId: part.id,
      sortOrder: part.sortOrder,
      title: part.title,
      currentContentHash,
      track: toTrack(role, currentContentHash, byPart.get(part.id) ?? null),
    };
  });

  return {
    workId,
    role,
    summary: summarize(rows.map((r) => r.track)),
    parts: rows,
  };
}

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

/**
 * Learner: published work only; refuses stale (contentHash mismatch).
 * Missing storage objects are not preflighted — `/api/assets/:id` GetObject returns 404.
 */
export async function getPublishedPartAudioTrack(partId: string, role: TtsVoiceRole): Promise<ReaderAudioTrack> {
  const [part] = await db
    .select({
      id: readingPartTable.id,
      title: readingPartTable.title,
      body: readingPartTable.body,
      workId: readingPartTable.workId,
    })
    .from(readingPartTable)
    .innerJoin(readingWorkTable, eq(readingPartTable.workId, readingWorkTable.id))
    .where(and(eq(readingPartTable.id, partId), eq(readingWorkTable.status, 'published')))
    .limit(1);

  if (!part) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.PART);
  }

  const sourceHash = hashPartAudioContent(part.body);
  const kind = audioKindForRole(role);
  const [asset] = await db
    .select()
    .from(contentAssetTable)
    .where(and(eq(contentAssetTable.partId, partId), eq(contentAssetTable.kind, kind)))
    .limit(1);
  if (!asset || asset.status !== 'ready' || asset.contentHash !== sourceHash) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.PART_AUDIO);
  }

  const meta = asset.meta ?? {};
  const wordTimings = (meta.timeline ?? []).flatMap((seg) =>
    seg.wordTimings.map((w) => ({
      ...w,
      audioOffsetMs: intMs(w.audioOffsetMs),
      durationMs: intMs(w.durationMs),
    })),
  );

  return {
    role,
    mimeType: asset.mimeType,
    voice: meta.voice ?? roleForAudioKind(kind),
    audioUrl: assetUrl(asset.id),
    assetId: asset.id,
    durationMs: meta.durationMs != null ? intMs(meta.durationMs) : null,
    wordTimings,
  };
}
