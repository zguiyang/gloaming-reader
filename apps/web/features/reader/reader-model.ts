/** Reader UI types — aligned with split reader APIs. */

import type { ReaderAudioAvailability, ReadingStateStatus } from '@gloaming/shared/reader';
import type { PartSummary } from '@gloaming/shared/works';

export type ReaderFontSize = 'sm' | 'md' | 'lg';

export type ReaderAiMode = 'closed' | 'inline' | 'drawer';

export type ReaderAudioStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'failed';

export type ReaderAiMessageSource = 'inline' | 'drawer';

export type ReaderAiMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  source: ReaderAiMessageSource;
  anchor?: { paragraphId: string; selectedText: string };
};

export type ReaderProgressState = {
  status: ReadingStateStatus;
  revision?: number;
  progressRatio: number;
  completedThroughSortOrder: number;
  totalPartCount: number;
  lastReadAt: string;
  completedAt: string | null;
};

export type ReaderViewModel = {
  workId: string;
  workTitle: string;
  coverAssetId: string | null;
  tags: string[];
  parts: PartSummary[];
  partId: string;
  partTitle: string;
  sortOrder: number;
  html: string;
  state: ReaderProgressState | null;
  audioAvailable: ReaderAudioAvailability;
};

/** @deprecated Use ReaderViewModel */
export type ReaderSession = ReaderViewModel & {
  title: string;
};

export type ReaderSelectionRect = {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
};

export type ReaderSelection = {
  quote: string;
  paragraphId: string;
  contextSentence?: string;
  rect?: ReaderSelectionRect;
  top: number;
  left: number;
};

export function sortedParts(parts: PartSummary[]): PartSummary[] {
  return [...parts].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

export function partIndex(parts: PartSummary[], partId: string): number {
  return sortedParts(parts).findIndex((part) => part.id === partId);
}

export function adjacentPart(parts: PartSummary[], partId: string, direction: 'prev' | 'next'): PartSummary | null {
  const ordered = sortedParts(parts);
  const index = ordered.findIndex((part) => part.id === partId);
  if (index < 0) {
    return null;
  }
  const nextIndex = direction === 'prev' ? index - 1 : index + 1;
  return ordered[nextIndex] ?? null;
}

/** Viewport highlight only — never bind to reading progress. */
export function isCurrentChapter(partId: string, currentPartId: string): boolean {
  return partId === currentPartId;
}

export type ReaderAudioRole = 'us' | 'uk';

/** Prefer `preferred` when available; else us → uk. */
export function resolveAudioRole(
  available: ReaderAudioAvailability,
  preferred: ReaderAudioRole | null = null,
): ReaderAudioRole | null {
  if (preferred && available[preferred]) {
    return preferred;
  }
  if (available.us) {
    return 'us';
  }
  if (available.uk) {
    return 'uk';
  }
  return null;
}

/** TTS mini-player playback rates — click cycles in this order. */
export const READER_PLAYBACK_RATES = [0.5, 1, 1.5, 2] as const;
export type ReaderPlaybackRate = (typeof READER_PLAYBACK_RATES)[number];
export const DEFAULT_READER_PLAYBACK_RATE: ReaderPlaybackRate = 1;

export function nextPlaybackRate(current: ReaderPlaybackRate): ReaderPlaybackRate {
  const index = READER_PLAYBACK_RATES.indexOf(current);
  return READER_PLAYBACK_RATES[(index + 1) % READER_PLAYBACK_RATES.length]!;
}

export function formatPlaybackRate(rate: ReaderPlaybackRate): string {
  return `${rate}×`;
}
