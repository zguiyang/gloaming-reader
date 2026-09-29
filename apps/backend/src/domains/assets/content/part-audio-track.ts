import { and, eq } from 'drizzle-orm';

import { contentAsset as contentAssetTable } from '@gloaming/db';
import { audioKindForRole, roleForAudioKind } from '@gloaming/shared/content-assets';
import { type ReaderAudioTrack } from '@gloaming/shared/reader';
import { type TtsVoiceRole } from '@gloaming/shared/tts';

import { assetUrl, intMs, wordTimingsFromTimeline } from '@/domains/assets/content/track-view';
import type { WorkReadActor } from '@/domains/works/access';
import { requireReadablePart } from '@/domains/works/access';
import { hashPartAudioContent } from '@/domains/works/content';
import { db } from '@/infra/db';
import { NotFoundError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

/**
 * Reader audio for a part the actor may read; refuses stale (contentHash mismatch).
 * Missing storage objects are not preflighted — `/api/assets/:id` GetObject returns 404.
 */
export async function getPartAudioTrackForActor(
  actor: WorkReadActor,
  partId: string,
  role: TtsVoiceRole,
): Promise<ReaderAudioTrack> {
  const part = await requireReadablePart(actor, partId);

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
  const wordTimings = wordTimingsFromTimeline(meta.timeline);

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
