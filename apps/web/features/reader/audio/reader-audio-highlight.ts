'use client';

import { type RefObject, useCallback, useLayoutEffect, useRef } from 'react';

import type { TtsWordTiming } from '@gloaming/shared/tts';

import { activeWordSyncKey, buildTimingRanges, findActiveWordTiming } from '@/features/reader/audio/reader-audio-sync';
import type { ReaderAudioStatus } from '@/features/reader/reader-model';

/** Attribute marking temporary listen-highlight wrappers. */
export const READER_AUDIO_WORD_ATTR = 'data-reader-audio-word';

/**
 * Visual parity with Learning Room AudioWordLine active state —
 * soft wash + inset underline without layout jitter.
 */
export const READER_AUDIO_WORD_ACTIVE_CLASS =
  'box-decoration-clone rounded-[0.2em] px-[0.12em] -mx-[0.12em] transition-[color,background-color,box-shadow] duration-300 ease-out-soft bg-primary/20 text-brand-deep shadow-[inset_0_-0.12em_0_0_color-mix(in_oklab,var(--brand)_40%,transparent)]';

function unwrapHighlightSpans(root: ParentNode): void {
  const spans = root.querySelectorAll(`[${READER_AUDIO_WORD_ATTR}]`);
  for (const span of spans) {
    const parent = span.parentNode;
    if (!parent) continue;
    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span);
    }
    parent.removeChild(span);
    if (parent.nodeType === Node.ELEMENT_NODE) {
      (parent as Element).normalize();
    }
  }
}

function wrapSingleTextRange(range: Range): boolean {
  if (range.collapsed) {
    return false;
  }
  const start = range.startContainer;
  const end = range.endContainer;
  if (start !== end || start.nodeType !== Node.TEXT_NODE) {
    return false;
  }
  const doc = start.ownerDocument;
  if (!doc) {
    return false;
  }
  const span = doc.createElement('span');
  span.setAttribute(READER_AUDIO_WORD_ATTR, '1');
  span.className = READER_AUDIO_WORD_ACTIVE_CLASS;
  try {
    range.surroundContents(span);
    return true;
  } catch {
    span.remove();
    return false;
  }
}

/**
 * Wrap each text-node slice inside `range` (for words that cross element boundaries).
 */
function wrapRangeTextSlices(range: Range): boolean {
  const doc = range.startContainer.ownerDocument;
  if (!doc) {
    return false;
  }

  const texts: Text[] = [];
  const root = range.commonAncestorContainer;
  const walkerRoot = root.nodeType === Node.ELEMENT_NODE ? root : root.parentNode;
  if (!walkerRoot) {
    return false;
  }

  const walker = doc.createTreeWalker(walkerRoot, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (range.intersectsNode(node) && node.nodeType === Node.TEXT_NODE) {
      texts.push(node as Text);
    }
    node = walker.nextNode();
  }

  // Snapshot offsets first, then wrap last→first so earlier text nodes stay valid.
  const slices: Array<{ node: Text; from: number; to: number }> = [];
  for (const text of texts) {
    const full = text.data;
    if (!full) continue;
    let from = 0;
    let to = full.length;
    if (text === range.startContainer) {
      from = range.startOffset;
    }
    if (text === range.endContainer) {
      to = range.endOffset;
    }
    if (to <= from) continue;
    slices.push({ node: text, from, to });
  }

  let isWrapped = false;
  for (let i = slices.length - 1; i >= 0; i -= 1) {
    const slice = slices[i]!;
    if (!slice.node.isConnected) continue;
    const piece = doc.createRange();
    piece.setStart(slice.node, Math.min(slice.from, slice.node.data.length));
    piece.setEnd(slice.node, Math.min(slice.to, slice.node.data.length));
    if (wrapSingleTextRange(piece)) {
      isWrapped = true;
    }
  }
  return isWrapped;
}

export type ApplyReaderAudioHighlightResult = {
  applied: boolean;
  /** First highlight element, for scroll-into-view. */
  anchor: HTMLElement | null;
};

/** Remove any active listen-highlight wrappers under `root`. */
export function clearReaderAudioHighlight(root: ParentNode | null): void {
  if (!root) return;
  unwrapHighlightSpans(root);
}

/**
 * Highlight the spoken word by wrapping `range` with the legacy active styles.
 * Caller should clear previous wrappers first when ranges were rebuilt from a clean DOM.
 */
export function applyReaderAudioHighlight(
  root: ParentNode | null,
  range: Range | null,
): ApplyReaderAudioHighlightResult {
  if (!root) {
    return { applied: false, anchor: null };
  }
  if (!range || range.collapsed) {
    return { applied: false, anchor: null };
  }

  // Clone so surroundContents / multi-wrap cannot invalidate the caller's stored Range.
  const live = range.cloneRange();
  let isApplied = wrapSingleTextRange(live);
  if (!isApplied) {
    isApplied = wrapRangeTextSlices(live);
  }
  const anchor = root.querySelector(`[${READER_AUDIO_WORD_ATTR}]`);
  if (isApplied && anchor instanceof HTMLElement) {
    const rect = anchor.getBoundingClientRect();
    const isInView = rect.top >= 0 && rect.bottom <= (window.innerHeight || document.documentElement.clientHeight);
    if (!isInView) {
      anchor.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }
  return { applied: isApplied, anchor: anchor instanceof HTMLElement ? anchor : null };
}

function readingBodyFromContainer(container: HTMLElement | null): HTMLElement | null {
  return container?.querySelector('.reading-body') ?? null;
}

export type UseReaderListenHighlightArgs = {
  contentRef: RefObject<HTMLDivElement | null>;
  partId: string | null;
  html: string | null;
  wordTimings: readonly TtsWordTiming[] | null;
  audioStatus: ReaderAudioStatus;
  /** When true, skip applying highlight (selection assist in progress). */
  selectionActive: boolean;
  audioRef: RefObject<HTMLAudioElement | null>;
  onActiveSentenceChange?: (sentenceIndex: number | null) => void;
};

/**
 * Paints the active spoken word while listening.
 * Rebuilds timing→Range after each clear — wraps invalidate stored Ranges.
 */
export function useReaderListenHighlight({
  contentRef,
  partId,
  html,
  wordTimings,
  audioStatus,
  selectionActive,
  audioRef,
  onActiveSentenceChange,
}: UseReaderListenHighlightArgs): { clearListenHighlight: () => void } {
  const lastSyncKeyRef = useRef<string | null>(null);
  const clearListenHighlight = useCallback(() => {
    clearReaderAudioHighlight(readingBodyFromContainer(contentRef.current));
    lastSyncKeyRef.current = null;
    onActiveSentenceChange?.(null);
  }, [contentRef, onActiveSentenceChange]);

  useLayoutEffect(() => {
    clearListenHighlight();
  }, [partId, html, clearListenHighlight]);

  useLayoutEffect(() => {
    if (audioStatus !== 'playing' && audioStatus !== 'paused') {
      if (audioStatus === 'idle' || audioStatus === 'ready' || audioStatus === 'failed') {
        clearListenHighlight();
      }
      return;
    }

    if (!wordTimings?.length) {
      return;
    }

    function paintFromAudio(force = false) {
      const audio = audioRef.current;
      if (!audio || !wordTimings?.length) return;
      if (selectionActive) return;

      const timeMs = audio.currentTime * 1000;
      const active = findActiveWordTiming(wordTimings, timeMs);
      const key = activeWordSyncKey(active);
      if (!force && key === lastSyncKeyRef.current) {
        return;
      }
      lastSyncKeyRef.current = key;

      const body = readingBodyFromContainer(contentRef.current);
      clearReaderAudioHighlight(body);
      if (!active || !body) {
        onActiveSentenceChange?.(null);
        return;
      }
      // Rebuild after clear — previous wraps invalidate Range boundaries.
      const range = buildTimingRanges(body, wordTimings).get(key) ?? null;
      const highlightResult = applyReaderAudioHighlight(body, range);
      if (highlightResult.applied && highlightResult.anchor) {
        const sentenceEl = highlightResult.anchor.closest('[data-sentence-index]');
        const idx = sentenceEl ? Number(sentenceEl.getAttribute('data-sentence-index')) : null;
        onActiveSentenceChange?.(Number.isNaN(idx) ? null : idx);
      } else {
        onActiveSentenceChange?.(null);
      }
    }

    paintFromAudio(true);

    if (audioStatus !== 'playing') {
      return;
    }

    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const onTimeUpdate = () => {
      paintFromAudio();
    };
    audio.addEventListener('timeupdate', onTimeUpdate);
    const intervalId = window.setInterval(() => paintFromAudio(), 100);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      window.clearInterval(intervalId);
    };
  }, [audioStatus, wordTimings, audioRef, contentRef, selectionActive, onActiveSentenceChange, clearListenHighlight]);

  return { clearListenHighlight };
}
