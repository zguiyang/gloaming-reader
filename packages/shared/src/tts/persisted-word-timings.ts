import { type TtsWordTiming, ttsWordTimingSchema } from './tts.ts';

const CORRUPT_TIMING_TEXT = /^(?:amp|lt|gt);$/i;

function isCorruptProviderTimingText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  return CORRUPT_TIMING_TEXT.test(trimmed);
}

/**
 * Drop historical or provider word-timing rows that do not satisfy the public TTS timing contract.
 * Keeps playable audio paths alive when only some rows are corrupt.
 */
export function filterPersistedWordTimings(entries: readonly unknown[]): TtsWordTiming[] {
  const filtered: TtsWordTiming[] = [];
  for (const entry of entries) {
    const parsed = ttsWordTimingSchema.safeParse(entry);
    if (!parsed.success) {
      continue;
    }
    if (isCorruptProviderTimingText(parsed.data.text)) {
      continue;
    }
    filtered.push({
      text: parsed.data.text,
      audioOffsetMs: Math.round(parsed.data.audioOffsetMs),
      durationMs: Math.round(parsed.data.durationMs),
      textOffset: parsed.data.textOffset,
    });
  }
  return filtered;
}
