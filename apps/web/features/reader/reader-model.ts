/** Reader UI types — aligned with split reader APIs. */

import { DEFAULT_LOCALE, type Locale, t } from '@gloaming/i18n';
import type { ReaderAudioAvailability, ReadingAnchor, ReadingStateStatus } from '@gloaming/shared/reader';
import type { PartSummary } from '@gloaming/shared/works';

export type ReaderInlineAssistKind = 'explain' | 'translate' | 'ask';

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
  /** Saved within-part scroll position for the open part, when present. */
  anchor: ReadingAnchor | null;
};

export type ReaderViewModel = {
  workId: string;
  workTitle: string;
  coverAssetId: string | null;
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

/** Minimum delay between within-chapter position writes while scrolling. */
export const READER_ANCHOR_THROTTLE_MS = 2_000;
/** Skip a write when the ratio barely changed, to avoid chatty persistence. */
export const READER_ANCHOR_MIN_DELTA = 0.02;
/**
 * Upper bound on how long an in-flight restore keeps re-applying the saved
 * ratio while images, webfonts, and lazy content settle the layout. The
 * restore reacts to real height changes; this only guarantees it releases the
 * scroll position (so reader scrolls persist again) even if layout never fires.
 */
export const READER_ANCHOR_RESTORE_SETTLE_MS = 2_000;

export function scrollPositionRatio(metrics: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): number {
  const max = metrics.scrollHeight - metrics.clientHeight;
  if (max <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, metrics.scrollTop / max));
}

export function scrollTopForRatio(ratio: number, metrics: { scrollHeight: number; clientHeight: number }): number {
  const max = metrics.scrollHeight - metrics.clientHeight;
  if (max <= 0) {
    return 0;
  }
  return Math.min(max, Math.max(0, ratio * max));
}

/** A saved position applies only to the part it was saved for. */
export function resolveAnchorRatio(anchor: ReadingAnchor | null | undefined, partId: string): number | null {
  if (!anchor || anchor.partId !== partId) {
    return null;
  }
  return anchor.ratio;
}

/** Throttle + minimum-delta gate for within-chapter position writes. */
export function shouldPersistAnchor(input: {
  lastSavedRatio: number | null;
  lastSavedAt: number;
  now: number;
  ratio: number;
  throttleMs?: number;
  minDelta?: number;
}): boolean {
  const throttleMs = input.throttleMs ?? READER_ANCHOR_THROTTLE_MS;
  const minDelta = input.minDelta ?? READER_ANCHOR_MIN_DELTA;
  if (input.lastSavedRatio != null && Math.abs(input.ratio - input.lastSavedRatio) < minDelta) {
    return false;
  }
  return input.now - input.lastSavedAt >= throttleMs;
}

/**
 * Ratio for a lifecycle keepalive flush. The live container ratio is fresher
 * than a scheduled one, so it wins; a ratio already flushed for this part is
 * skipped so visibility/pagehide/unmount do not repeat the same write. While a
 * restore owns the scroll position, nothing is flushed: a transient layout
 * position is not the reader's position.
 */
export function resolveAnchorFlushRatio(input: {
  containerRatio: number | null;
  pendingRatio: number | null;
  lastFlushedRatio: number | null;
  isRestorePending?: boolean;
}): number | null {
  if (input.isRestorePending) {
    return null;
  }
  const ratio = input.containerRatio ?? input.pendingRatio;
  if (ratio == null || ratio === input.lastFlushedRatio) {
    return null;
  }
  return ratio;
}

export type ReaderAnchorRestoreStatus = 'restoring' | 'settled' | 'cancelled';

/**
 * In-flight restoration of a saved within-part position. The restore keeps
 * ownership of `scrollTop` until it settles or the reader scrolls, so the
 * position it writes is never mistaken for reader intent.
 */
export type ReaderAnchorRestore = {
  partId: string;
  ratio: number;
  /** Wall-clock bound; after this the restore stops re-applying. */
  deadline: number;
  status: ReaderAnchorRestoreStatus;
  /** Scrollable range of the last write; re-applies when this changes. */
  lastAppliedMaxScroll: number | null;
};

export function startAnchorRestore(input: {
  partId: string;
  ratio: number;
  /** Defaults to the current time; tests pass it for determinism. */
  now?: number;
  settleMs?: number;
}): ReaderAnchorRestore | null {
  if (!Number.isFinite(input.ratio) || input.ratio <= 0 || input.ratio > 1) {
    return null;
  }
  const settleMs = input.settleMs ?? READER_ANCHOR_RESTORE_SETTLE_MS;
  const now = input.now ?? Date.now();
  return {
    partId: input.partId,
    ratio: input.ratio,
    deadline: now + settleMs,
    status: 'restoring',
    lastAppliedMaxScroll: null,
  };
}

/**
 * Decide whether an in-flight restore should (re)write the scroll offset for a
 * fresh content measurement. It re-applies while restoring and before the
 * bounded deadline, only when the scrollable range actually changed, and yields
 * permanently once the reader scrolls.
 */
export function planAnchorRestoreApply(input: {
  restore: ReaderAnchorRestore;
  now: number;
  hasUserScrolled: boolean;
  metrics: { scrollHeight: number; clientHeight: number };
}): { restore: ReaderAnchorRestore; applyTop: number | null } {
  const { restore } = input;
  if (restore.status !== 'restoring') {
    return { restore, applyTop: null };
  }
  if (input.hasUserScrolled) {
    return { restore: { ...restore, status: 'cancelled' }, applyTop: null };
  }
  if (input.now >= restore.deadline) {
    return { restore: { ...restore, status: 'settled' }, applyTop: null };
  }
  const maxScroll = Math.max(0, input.metrics.scrollHeight - input.metrics.clientHeight);
  if (maxScroll <= 0 || restore.lastAppliedMaxScroll === maxScroll) {
    return { restore, applyTop: null };
  }
  return {
    restore: { ...restore, lastAppliedMaxScroll: maxScroll },
    applyTop: scrollTopForRatio(restore.ratio, input.metrics),
  };
}

/** True while a restore still owns the scroll position. */
export function isAnchorRestorePending(restore: ReaderAnchorRestore | null | undefined, now: number): boolean {
  return restore != null && restore.status === 'restoring' && now < restore.deadline;
}

/**
 * Release the one-shot restore markers for a single part when its effect
 * cleanup runs. Only an in-flight restore is released: that is the Strict Mode
 * replay case (setup → cleanup → setup) where the replayed setup must re-attach
 * the ResizeObserver/listeners. A settled or cancelled restore keeps its marker
 * so a later dependency change cannot re-apply the anchor over the reader.
 */
export function releaseAnchorRestoreMarkers(input: {
  partId: string;
  restoredPartId: string | null;
  restore: ReaderAnchorRestore | null;
}): { restoredPartId: string | null; restore: ReaderAnchorRestore | null } {
  const isRestoreInFlight =
    input.restore != null && input.restore.partId === input.partId && input.restore.status === 'restoring';
  if (!isRestoreInFlight) {
    return { restoredPartId: input.restoredPartId, restore: input.restore };
  }
  return {
    restoredPartId: input.restoredPartId === input.partId ? null : input.restoredPartId,
    restore: null,
  };
}

const READER_SCROLL_INTENT_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']);

/**
 * A keydown is reader scroll intent only for keys the browser maps to scrolling
 * the reading column. Space counts only without the command modifiers the
 * browser reserves for other actions (Ctrl/Alt/Meta); Shift+Space still scrolls.
 */
export function isReaderScrollIntentKey(input: {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  /** True when the event targets a control that owns scroll/activation keys. */
  isInteractiveTarget?: boolean;
}): boolean {
  // A focused button/link/editable owns the key (Space activates, arrows edit),
  // so it is not reader scroll intent even if the key would otherwise scroll.
  if (input.isInteractiveTarget) {
    return false;
  }
  if (READER_SCROLL_INTENT_KEYS.has(input.key)) {
    return true;
  }
  if (input.key === ' ' || input.key === 'Spacebar' || input.key === 'Space') {
    return !input.ctrlKey && !input.altKey && !input.metaKey;
  }
  return false;
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

export function formatReaderChapterTitle(
  title: string | null | undefined,
  index: number,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const trimmed = title?.trim();
  if (trimmed) {
    return trimmed;
  }
  return t(locale, 'content.bookDetail.chapterFallback', { n: index });
}

export function readerFontSizeAriaLabel(fontSize: ReaderFontSize, locale: Locale = DEFAULT_LOCALE): string {
  if (fontSize === 'sm') {
    return t(locale, 'content.reader.chrome.fontSizeSmall');
  }
  if (fontSize === 'lg') {
    return t(locale, 'content.reader.chrome.fontSizeLarge');
  }
  return t(locale, 'content.reader.chrome.fontSizeMedium');
}

export function formatPhoneticRoleLabel(
  role: 'us' | 'uk' | 'general' | undefined,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (role === 'uk') {
    return t(locale, 'content.reader.tts.ukShort');
  }
  return t(locale, 'content.reader.tts.usShort');
}

export function formatInlineAssistPrompt(
  locale: Locale,
  kind: ReaderInlineAssistKind,
  selectedText: string,
  question?: string,
): string {
  if (kind === 'translate') {
    return t(locale, 'content.reader.assist.promptTranslate', { text: selectedText });
  }
  if (kind === 'ask') {
    return question?.trim() || t(locale, 'content.reader.assist.promptAsk', { text: selectedText });
  }
  return t(locale, 'content.reader.assist.promptExplain', { text: selectedText });
}

export function formatDictionaryWordDeepDivePrompt(word: string, locale: Locale = DEFAULT_LOCALE): string {
  return t(locale, 'content.reader.assist.wordDeepDivePrompt', { word });
}
