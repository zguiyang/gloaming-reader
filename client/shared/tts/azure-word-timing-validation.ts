import type { TtsWordTiming } from './tts.ts';

export type AzureWordBoundaryInput = {
  text: string;
  audioOffsetMs: number;
  durationMs: number;
  textOffset: number;
};

export type ValidateAzureWordTimingsContext = {
  ttsTextLength: number;
  mapTtsOffsetToSource: (ttsOffset: number) => number;
};

const CORRUPT_TIMING_TEXT = /^(?:amp|lt|gt);$/i;

function isFiniteNonNegativeInt(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && Math.floor(n) === n;
}

function isCorruptProviderTimingText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  return CORRUPT_TIMING_TEXT.test(trimmed);
}

/**
 * Sanitize Azure word boundaries before cache / DB / API.
 * Use an identity `mapTtsOffsetToSource` to keep `textOffset` in `ttsText` space (Redis cache payload).
 * Returns an empty array when any boundary is invalid (audio may still succeed).
 */
export function validateAzureWordTimings(
  boundaries: readonly AzureWordBoundaryInput[],
  context: ValidateAzureWordTimingsContext,
): TtsWordTiming[] {
  if (boundaries.length === 0) {
    return [];
  }

  const { ttsTextLength, mapTtsOffsetToSource } = context;
  if (!Number.isFinite(ttsTextLength) || ttsTextLength < 0) {
    return [];
  }

  let lastAudioOffset = -1;
  const validated: TtsWordTiming[] = [];

  for (const boundary of boundaries) {
    const { text, audioOffsetMs, durationMs, textOffset } = boundary;

    if (textOffset === -1 || !Number.isFinite(textOffset) || textOffset < 0) {
      return [];
    }
    if (!isFiniteNonNegativeInt(textOffset) || textOffset >= ttsTextLength) {
      return [];
    }
    if (!Number.isFinite(audioOffsetMs) || !Number.isFinite(durationMs)) {
      return [];
    }
    if (audioOffsetMs < 0 || durationMs < 0) {
      return [];
    }

    const audioInt = Math.round(audioOffsetMs);
    const durationInt = Math.round(durationMs);
    if (audioInt < lastAudioOffset) {
      return [];
    }
    lastAudioOffset = audioInt;

    if (isCorruptProviderTimingText(text)) {
      return [];
    }

    const sourceOffset = mapTtsOffsetToSource(textOffset);
    if (!Number.isFinite(sourceOffset) || sourceOffset < 0) {
      return [];
    }

    validated.push({
      text,
      audioOffsetMs: audioInt,
      durationMs: durationInt,
      textOffset: sourceOffset,
    });
  }

  return validated;
}
