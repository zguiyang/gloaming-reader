import type { ReaderAudioManifest, ReaderAudioManifestSegment, ReaderAudioSegment } from '@gloaming/shared/reader';
import type { TtsVoiceRole } from '@gloaming/shared/tts';

import type { ReaderAudioConfig } from '@/domains/reader-audio/config';
import { resolveReaderAudioConfig } from '@/domains/reader-audio/config';
import { buildReaderAudioConfigFingerprint, buildReaderAudioIdentity } from '@/domains/reader-audio/identity';
import {
  claimSegmentGeneration,
  failSegmentGeneration,
  finalizeSegmentReady,
  findSegmentByIdentity,
  waitForSegmentReady,
} from '@/domains/reader-audio/repository';
import { deriveReaderAudioSegments, type ReaderAudioDerivedSegment } from '@/domains/reader-audio/segmenter';
import { putSegmentObject } from '@/domains/reader-audio/storage';
import { synthesizeReaderAudioSegment } from '@/domains/reader-audio/synthesis';
import type { WorkReadActor } from '@/domains/works/access';
import { requireReadablePart } from '@/domains/works/access';
import { getObjectStream } from '@/infra/storage';
import { HTTP_STATUS } from '@/shared/constants';
import { AppError, NotFoundError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

function segmentAudioUrl(partId: string, index: number, role: TtsVoiceRole, segmentHash: string): string {
  return `/api/reader/parts/${partId}/audio/segments/${index}/audio?role=${role}&hash=${segmentHash}`;
}

function toManifestSegment(segment: ReaderAudioDerivedSegment): ReaderAudioManifestSegment {
  return {
    index: segment.index,
    key: segment.key,
    segmentHash: segment.segmentHash,
    paragraphAnchor: segment.paragraphAnchor,
    paragraphTextOffset: segment.paragraphTextOffset,
    textLength: segment.textLength,
  };
}

function buildIdentity(config: ReaderAudioConfig, partId: string, role: TtsVoiceRole, segmentHash: string) {
  return buildReaderAudioIdentity({
    partId,
    role,
    scopeKey: config.scopeKey,
    ownerUserId: config.ownerUserId,
    provider: config.row.provider,
    region: config.row.region,
    voice: config.voice,
    segmentHash,
  });
}

/**
 * Lazy audio manifest: derived segments + config fingerprint, no synthesis.
 * `ttsConfigured:false` when this actor has no usable TTS configuration.
 */
export async function getReaderAudioManifest(
  actor: WorkReadActor,
  partId: string,
  role: TtsVoiceRole,
): Promise<ReaderAudioManifest> {
  const access = await requireReadablePart(actor, partId);
  const config = await resolveReaderAudioConfig(actor, role);
  if (!config) {
    return { role, ttsConfigured: false, configFingerprint: null, segments: [] };
  }
  const segments = deriveReaderAudioSegments(access.body).map(toManifestSegment);
  return {
    role,
    ttsConfigured: true,
    configFingerprint: buildReaderAudioConfigFingerprint({
      provider: config.row.provider,
      region: config.row.region,
      voice: config.voice,
    }),
    segments,
  };
}

/**
 * Segment payload with lease single-flight: ready rows are served directly,
 * a miss claims generation, waiters poll and never double-synthesize.
 */
export async function getReaderAudioSegment(
  actor: WorkReadActor,
  partId: string,
  role: TtsVoiceRole,
  index: number,
  expectedHash?: string,
): Promise<ReaderAudioSegment> {
  const access = await requireReadablePart(actor, partId);
  const derived = requireDerivedSegment(access.body, index);

  if (expectedHash && expectedHash !== derived.segmentHash) {
    throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.READER_AUDIO.MANIFEST_STALE);
  }

  const config = await resolveReaderAudioConfig(actor, role);
  if (!config) {
    throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.TTS.NOT_CONFIGURED);
  }

  const identity = buildIdentity(config, partId, role, derived.segmentHash);

  const existing = await findSegmentByIdentity(identity);
  if (existing?.status === 'ready') {
    return toSegmentPayload(partId, role, derived, existing);
  }

  const claim = await claimSegmentGeneration(identity, {
    segmentIndex: derived.index,
    segmentKey: derived.key,
    paragraphAnchor: derived.paragraphAnchor,
    paragraphTextOffset: derived.paragraphTextOffset,
    textLength: derived.textLength,
    voice: config.voice,
  });

  if (claim.kind === 'ready') {
    return toSegmentPayload(partId, role, derived, claim.row);
  }

  if (claim.kind === 'wait') {
    const row = await waitForSegmentReady(identity);
    return toSegmentPayload(partId, role, derived, row);
  }

  try {
    const synthesized = await synthesizeReaderAudioSegment({
      row: config.row,
      voice: config.voice,
      synthText: derived.synthText,
      userId: actor.userId,
      workId: access.workId,
      partId,
      role,
    });
    await putSegmentObject(identity.storageKey, synthesized.audio);
    const published = await finalizeSegmentReady(claim.id, claim.token, {
      storageKey: identity.storageKey,
      voice: synthesized.voice,
      mimeType: synthesized.mimeType,
      durationMs: synthesized.durationMs,
      wordTimings: synthesized.wordTimings,
    });
    if (!published) {
      // Lease was taken over while synthesizing — serve the winner's row.
      const row = await waitForSegmentReady(identity);
      return toSegmentPayload(partId, role, derived, row);
    }
    return toSegmentPayload(partId, role, derived, {
      voice: synthesized.voice,
      mimeType: synthesized.mimeType,
      durationMs: synthesized.durationMs,
      wordTimings: synthesized.wordTimings,
    });
  } catch (error) {
    const errorCode = error instanceof AppError ? error.code : ERROR_CODES.TTS.SYNTHESIS_FAILED;
    await failSegmentGeneration(claim.id, claim.token, errorCode);
    throw error;
  }
}

export type ReaderAudioStreamResult = {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: number | null;
  contentRange: string | null;
  etag: string | null;
};

/**
 * Byte stream for one ready segment. Access is re-checked and the object-store
 * identity is rebuilt from this actor's own resolved configuration, so a user
 * BYOK segment can never be fetched by another user or anonymously.
 */
export async function streamReaderAudioSegment(
  actor: WorkReadActor,
  partId: string,
  role: TtsVoiceRole,
  index: number,
  hash: string,
  range?: { start: number; end?: number },
): Promise<ReaderAudioStreamResult> {
  const access = await requireReadablePart(actor, partId);
  const derived = requireDerivedSegment(access.body, index);
  if (derived.segmentHash !== hash) {
    throw new NotFoundError(ERROR_CODES.READER_AUDIO.SEGMENT_NOT_FOUND);
  }

  const config = await resolveReaderAudioConfig(actor, role);
  if (!config) {
    throw new NotFoundError(ERROR_CODES.READER_AUDIO.SEGMENT_NOT_FOUND);
  }

  const identity = buildIdentity(config, partId, role, derived.segmentHash);
  const row = await findSegmentByIdentity(identity);
  if (
    !row ||
    row.status !== 'ready' ||
    row.scopeKey !== identity.scopeKey ||
    row.ownerUserId !== identity.ownerUserId
  ) {
    throw new NotFoundError(ERROR_CODES.READER_AUDIO.SEGMENT_NOT_FOUND);
  }

  const object = await getObjectStream(row.storageKey, range);
  if (!object) {
    throw new NotFoundError(ERROR_CODES.READER_AUDIO.SEGMENT_NOT_FOUND);
  }
  return {
    stream: object.stream,
    contentType: object.contentType,
    contentLength: object.contentLength,
    contentRange: object.contentRange,
    etag: object.etag,
  };
}

function requireDerivedSegment(body: string, index: number): ReaderAudioDerivedSegment {
  if (!Number.isInteger(index) || index < 0) {
    throw new NotFoundError(ERROR_CODES.READER_AUDIO.SEGMENT_NOT_FOUND);
  }
  const segment = deriveReaderAudioSegments(body)[index];
  if (!segment) {
    throw new NotFoundError(ERROR_CODES.READER_AUDIO.SEGMENT_NOT_FOUND);
  }
  return segment;
}

function toSegmentPayload(
  partId: string,
  role: TtsVoiceRole,
  derived: ReaderAudioDerivedSegment,
  audio: {
    voice: string;
    mimeType: string;
    durationMs: number | null;
    wordTimings: readonly { text: string; audioOffsetMs: number; durationMs: number; textOffset: number }[];
  },
): ReaderAudioSegment {
  return {
    index: derived.index,
    role,
    voice: audio.voice,
    mimeType: audio.mimeType,
    durationMs: audio.durationMs,
    wordTimings: [...audio.wordTimings],
    paragraphAnchor: derived.paragraphAnchor,
    paragraphTextOffset: derived.paragraphTextOffset,
    segmentHash: derived.segmentHash,
    audioUrl: segmentAudioUrl(partId, derived.index, role, derived.segmentHash),
  };
}
