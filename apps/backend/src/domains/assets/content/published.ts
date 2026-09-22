import { and, eq } from 'drizzle-orm';

import {
  contentAsset as contentAssetTable,
  readingPart as readingPartTable,
  readingWork as readingWorkTable,
} from '@gloaming/db';
import { audioKindForRole, roleForAudioKind } from '@gloaming/shared/content-assets';
import { type ReaderAudioTrack } from '@gloaming/shared/reader';
import { type TtsVoiceRole } from '@gloaming/shared/tts';

import { assetUrl, intMs } from '@/domains/assets/content/track-view';
import { hashPartAudioContent } from '@/domains/works/content';
import { db } from '@/infra/db';
import { NotFoundError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

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
