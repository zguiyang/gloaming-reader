import { type TtsWordTiming, validateAzureWordTimings } from '@gloaming/shared/tts';

import type { TtsConfigRow } from '@/domains/provider-scope';
import { recordTtsInvocation } from '@/domains/tts/log';
import { decryptApiKey } from '@/infra/llm';
import { rootLogger } from '@/infra/logging/logger';
import { synthesizeAzureTts } from '@/infra/tts';
import { HTTP_STATUS } from '@/shared/constants';
import { AppError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

const synthesisLogger = rootLogger.child({ module: 'ReaderAudioSynthesis' });

const SYNTHESIS_SOURCE = 'reader_segment';
const TTS_OUTPUT_MIME = 'audio/mpeg';

function intMs(n: number): number {
  return Math.round(n);
}

/** Segment duration when word timings are missing — migrated from the legacy whole-chapter pipeline. */
function estimateSegmentDurationMs(wordTimings: readonly TtsWordTiming[], audioByteLength: number): number {
  return intMs(
    wordTimings.length > 0
      ? Math.max(...wordTimings.map((w) => w.audioOffsetMs + w.durationMs), 0)
      : Math.max(1, (audioByteLength * 8) / 32),
  );
}

/** Identity map: segment synth text is the offset space — no source remapping inside a chunk. */
const mapTtsOffsetIdentity = (ttsOffset: number): number => ttsOffset;

export type ReaderAudioSynthesisInput = {
  row: TtsConfigRow;
  voice: string;
  synthText: string;
  userId?: string | null;
  workId?: string;
  partId: string;
  role: 'us' | 'uk';
};

export type ReaderAudioSynthesisResult = {
  audio: Buffer;
  mimeType: string;
  voice: string;
  wordTimings: TtsWordTiming[];
  durationMs: number;
};

/**
 * One direct Azure call for one segment. Deliberately bypasses the whole-chapter
 * Redis v2 cache (different scope/identity model) — the `part_audio_segment`
 * ready row is the cache. Every call is recorded in the TTS invocation log.
 */
export async function synthesizeReaderAudioSegment(
  input: ReaderAudioSynthesisInput,
): Promise<ReaderAudioSynthesisResult> {
  const { row, voice, synthText } = input;
  const startedAt = Date.now();
  const textLength = synthText.length;

  const invocationBase = {
    source: SYNTHESIS_SOURCE,
    userId: input.userId ?? null,
    workId: input.workId ?? null,
    partId: input.partId,
    voice,
    role: input.role,
    textLength,
    cached: false,
  };

  const fail = async (errorCode: string): Promise<never> => {
    await recordTtsInvocation({
      ...invocationBase,
      status: 'failure',
      errorCode,
      latencyMs: Date.now() - startedAt,
    });
    throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, errorCode);
  };

  if (!synthText.trim()) {
    return fail(ERROR_CODES.TTS.TEXT_REQUIRED);
  }

  let subscriptionKey: string;
  try {
    subscriptionKey = decryptApiKey(row.apiKeyCiphertext);
  } catch {
    return fail(ERROR_CODES.TTS.INVALID_CREDENTIALS);
  }

  let synthesized;
  try {
    synthesized = await synthesizeAzureTts({
      subscriptionKey,
      region: row.region,
      voice,
      text: synthText,
    });
  } catch (error) {
    synthesisLogger.warn({ err: error, partId: input.partId, role: input.role }, 'Reader segment synthesis failed');
    return fail(error instanceof AppError ? error.code : ERROR_CODES.TTS.SYNTHESIS_FAILED);
  }

  const wordTimings = validateAzureWordTimings(synthesized.wordTimings, {
    ttsTextLength: synthText.length,
    mapTtsOffsetToSource: mapTtsOffsetIdentity,
  });
  if (synthesized.wordTimings.length > 0 && wordTimings.length === 0) {
    synthesisLogger.warn(
      { partId: input.partId, role: input.role, rawBoundaryCount: synthesized.wordTimings.length },
      'Azure word timings failed validation; returning audio without timings',
    );
  }

  const durationMs = estimateSegmentDurationMs(wordTimings, synthesized.audio.byteLength);

  await recordTtsInvocation({
    ...invocationBase,
    status: 'success',
    latencyMs: Date.now() - startedAt,
  });

  return {
    audio: synthesized.audio,
    mimeType: synthesized.mimeType || TTS_OUTPUT_MIME,
    voice,
    wordTimings,
    durationMs,
  };
}
