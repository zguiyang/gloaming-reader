import { createHash } from 'node:crypto';

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
  MAX_CLAIM_RETRIES,
  waitForSegmentReady,
} from '@/domains/reader-audio/repository';
import { deriveReaderAudioSegments, type ReaderAudioDerivedSegment } from '@/domains/reader-audio/segmenter';
import { putSegmentObject } from '@/domains/reader-audio/storage';
import { synthesizeReaderAudioSegment } from '@/domains/reader-audio/synthesis';
import type { WorkReadActor } from '@/domains/works/access';
import { requireReadablePart } from '@/domains/works/access';
import { getObjectSize, getObjectStream, RangeNotSatisfiableError } from '@/infra/storage';
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
 * Process-local LRU memo for {@link deriveReaderAudioSegments}. Keyed by
 * `partId` + sha256(body), so every manifest/segment/stream request for the
 * same part reuses one cheerio derivation instead of re-parsing the chapter.
 * Pure: the cached value is exactly what the uncached call would return.
 */
const DERIVE_CACHE_LIMIT = 32;
const deriveCache = new Map<string, ReaderAudioDerivedSegment[]>();

export function deriveReaderAudioSegmentsForPart(partId: string, bodyHtml: string): ReaderAudioDerivedSegment[] {
  const cacheKey = `${partId}:${createHash('sha256').update(bodyHtml, 'utf8').digest('hex')}`;
  const cached = deriveCache.get(cacheKey);
  if (cached) {
    // Refresh recency — re-insert so the oldest entry is always the first key.
    deriveCache.delete(cacheKey);
    deriveCache.set(cacheKey, cached);
    return cached;
  }
  const derived = deriveReaderAudioSegments(bodyHtml);
  deriveCache.set(cacheKey, derived);
  while (deriveCache.size > DERIVE_CACHE_LIMIT) {
    const oldest = deriveCache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    deriveCache.delete(oldest);
  }
  return derived;
}

/** Test seam — clears the in-process segment-derivation cache. */
export function resetReaderAudioDeriveCache(): void {
  deriveCache.clear();
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
  const segments = deriveReaderAudioSegmentsForPart(partId, access.body).map(toManifestSegment);
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
  const derived = requireDerivedSegment(partId, access.body, index);

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

  const claimMeta = {
    segmentIndex: derived.index,
    segmentKey: derived.key,
    paragraphAnchor: derived.paragraphAnchor,
    paragraphTextOffset: derived.paragraphTextOffset,
    textLength: derived.textLength,
    voice: config.voice,
  };

  // Bounded claim loop: each wait that ends without a ready row (row failed,
  // holder lease expired, or wait budget exhausted) triggers at most
  // MAX_CLAIM_RETRIES re-claims — never an infinite wait or duplicate synthesis.
  let claim = await claimSegmentGeneration(identity, claimMeta);
  for (let retries = 0; ;) {
    if (claim.kind === 'ready') {
      return toSegmentPayload(partId, role, derived, claim.row);
    }

    if (claim.kind === 'wait') {
      const waited = await waitForSegmentReady(identity);
      if (waited.kind === 'ready') {
        return toSegmentPayload(partId, role, derived, waited.row);
      }
      if (retries >= MAX_CLAIM_RETRIES) {
        throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.AI.UNAVAILABLE);
      }
      retries += 1;
      claim = await claimSegmentGeneration(identity, claimMeta);
      continue;
    }

    // We hold the lease — synthesize exactly once for this claim.
    const activeClaim = claim;
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
      const published = await finalizeSegmentReady(activeClaim.id, activeClaim.token, {
        storageKey: identity.storageKey,
        voice: synthesized.voice,
        mimeType: synthesized.mimeType,
        durationMs: synthesized.durationMs,
        wordTimings: synthesized.wordTimings,
      });
      if (!published) {
        // Lease was taken over while synthesizing — wait for the winner's row,
        // or re-claim (bounded) if that winner failed as well.
        claim = { kind: 'wait' };
        continue;
      }
      return toSegmentPayload(partId, role, derived, {
        voice: synthesized.voice,
        mimeType: synthesized.mimeType,
        durationMs: synthesized.durationMs,
        wordTimings: synthesized.wordTimings,
      });
    } catch (error) {
      const errorCode = error instanceof AppError ? error.code : ERROR_CODES.TTS.SYNTHESIS_FAILED;
      await failSegmentGeneration(activeClaim.id, activeClaim.token, errorCode);
      throw error;
    }
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
  const derived = requireDerivedSegment(partId, access.body, index);
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

  let object;
  try {
    object = await getObjectStream(row.storageKey, range);
  } catch (error) {
    if (error instanceof RangeNotSatisfiableError && error.objectSize == null) {
      // S3 reports 416 without a body size — fetch it so the route can answer
      // with `Content-Range: bytes */<size>` (best effort).
      throw new RangeNotSatisfiableError(await getObjectSize(row.storageKey));
    }
    throw error;
  }
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

function requireDerivedSegment(partId: string, body: string, index: number): ReaderAudioDerivedSegment {
  if (!Number.isInteger(index) || index < 0) {
    throw new NotFoundError(ERROR_CODES.READER_AUDIO.SEGMENT_NOT_FOUND);
  }
  const segment = deriveReaderAudioSegmentsForPart(partId, body)[index];
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
