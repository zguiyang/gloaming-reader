import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE } from '@gloaming/i18n';

import {
  DEFAULT_READER_PLAYBACK_RATE,
  formatDictionaryWordDeepDivePrompt,
  formatInlineAssistPrompt,
  formatPhoneticRoleLabel,
  formatPlaybackRate,
  formatReaderChapterTitle,
  isAnchorRestorePending,
  isCurrentChapter,
  isReaderScrollIntentKey,
  nextPlaybackRate,
  planAnchorRestoreApply,
  READER_ANCHOR_RESTORE_SETTLE_MS,
  READER_PLAYBACK_RATES,
  readerFontSizeAriaLabel,
  type ReaderPlaybackRate,
  releaseAnchorRestoreMarkers,
  resolveAnchorFlushRatio,
  resolveAnchorRatio,
  scrollPositionRatio,
  scrollTopForRatio,
  shouldPersistAnchor,
  startAnchorRestore,
} from '@/features/reader/reader-model';

describe('isCurrentChapter', () => {
  it('matches only the open part id', () => {
    expect(isCurrentChapter('a', 'a')).toBe(true);
    expect(isCurrentChapter('a', 'b')).toBe(false);
  });
});

describe('playback rate', () => {
  it('defaults to 1×', () => {
    expect(DEFAULT_READER_PLAYBACK_RATE).toBe(1);
    expect(formatPlaybackRate(DEFAULT_READER_PLAYBACK_RATE)).toBe('1×');
  });

  it('cycles 0.5 → 1 → 1.5 → 2 → 0.5', () => {
    let rate: ReaderPlaybackRate = READER_PLAYBACK_RATES[0];
    expect(rate).toBe(0.5);
    rate = nextPlaybackRate(rate);
    expect(rate).toBe(1);
    rate = nextPlaybackRate(rate);
    expect(rate).toBe(1.5);
    rate = nextPlaybackRate(rate);
    expect(rate).toBe(2);
    rate = nextPlaybackRate(rate);
    expect(rate).toBe(0.5);
  });

  it('formats rates with ×', () => {
    expect(formatPlaybackRate(0.5)).toBe('0.5×');
    expect(formatPlaybackRate(1.5)).toBe('1.5×');
    expect(formatPlaybackRate(2)).toBe('2×');
  });
});

describe('formatReaderChapterTitle', () => {
  it('falls back to localized chapter label when title is empty', () => {
    expect(formatReaderChapterTitle('', 3, DEFAULT_LOCALE)).toBe('第 3 章');
    expect(formatReaderChapterTitle('Custom', 3, DEFAULT_LOCALE)).toBe('Custom');
  });

  it('localizes chapter fallback for en-US', () => {
    expect(formatReaderChapterTitle('', 3, 'en-US')).toBe('Chapter 3');
  });
});

describe('reader anchor', () => {
  it('computes a clamped scroll ratio', () => {
    expect(scrollPositionRatio({ scrollTop: 50, scrollHeight: 200, clientHeight: 100 })).toBeCloseTo(0.5);
    expect(scrollPositionRatio({ scrollTop: 0, scrollHeight: 100, clientHeight: 100 })).toBe(0);
    expect(scrollPositionRatio({ scrollTop: 500, scrollHeight: 200, clientHeight: 100 })).toBe(1);
  });

  it('maps a ratio back to a scroll offset', () => {
    expect(scrollTopForRatio(0.5, { scrollHeight: 200, clientHeight: 100 })).toBe(50);
    expect(scrollTopForRatio(0.5, { scrollHeight: 100, clientHeight: 100 })).toBe(0);
  });

  it('applies an anchor only to the part it was saved for', () => {
    expect(resolveAnchorRatio({ partId: 'p1', ratio: 0.4 }, 'p1')).toBe(0.4);
    expect(resolveAnchorRatio({ partId: 'p1', ratio: 0.4 }, 'p2')).toBeNull();
    expect(resolveAnchorRatio(null, 'p1')).toBeNull();
  });

  it('flushes the live ratio once, preferring it over a scheduled one', () => {
    expect(resolveAnchorFlushRatio({ containerRatio: 0.6, pendingRatio: 0.4, lastFlushedRatio: null })).toBe(0.6);
    expect(resolveAnchorFlushRatio({ containerRatio: 0.6, pendingRatio: 0.4, lastFlushedRatio: 0.6 })).toBeNull();
    expect(resolveAnchorFlushRatio({ containerRatio: null, pendingRatio: 0.4, lastFlushedRatio: null })).toBe(0.4);
    expect(resolveAnchorFlushRatio({ containerRatio: null, pendingRatio: 0.4, lastFlushedRatio: 0.4 })).toBeNull();
    expect(resolveAnchorFlushRatio({ containerRatio: null, pendingRatio: null, lastFlushedRatio: null })).toBeNull();
  });

  it('throttles writes and ignores sub-threshold movement', () => {
    expect(shouldPersistAnchor({ lastSavedRatio: null, lastSavedAt: 0, now: 10_000, ratio: 0.5 })).toBe(true);
    expect(shouldPersistAnchor({ lastSavedRatio: 0.5, lastSavedAt: 10_000, now: 11_000, ratio: 0.6 })).toBe(false);
    expect(shouldPersistAnchor({ lastSavedRatio: 0.5, lastSavedAt: 10_000, now: 12_500, ratio: 0.51 })).toBe(false);
    expect(shouldPersistAnchor({ lastSavedRatio: 0.5, lastSavedAt: 10_000, now: 12_500, ratio: 0.7 })).toBe(true);
  });
});

describe('reader anchor restore', () => {
  it('starts only for a positive ratio and settles at the bounded deadline', () => {
    expect(startAnchorRestore({ partId: 'p1', ratio: 0, now: 0 })).toBeNull();
    const restore = startAnchorRestore({ partId: 'p1', ratio: 0.4, now: 1_000 });
    expect(restore).not.toBeNull();
    expect(restore!.status).toBe('restoring');
    expect(restore!.deadline).toBe(1_000 + READER_ANCHOR_RESTORE_SETTLE_MS);
    expect(isAnchorRestorePending(restore, 1_000)).toBe(true);
    expect(isAnchorRestorePending(restore, restore!.deadline)).toBe(false);

    // Timeout/fallback: past the bounded settle window the restore releases scrollTop.
    const timedOut = planAnchorRestoreApply({
      restore: restore!,
      now: restore!.deadline,
      hasUserScrolled: false,
      metrics: { scrollHeight: 2_100, clientHeight: 100 },
    });
    expect(timedOut.restore.status).toBe('settled');
    expect(timedOut.applyTop).toBeNull();
  });

  it('applies once, then re-applies only when the scrollable range changes', () => {
    const restore = startAnchorRestore({ partId: 'p1', ratio: 0.5, now: 0 })!;
    const first = planAnchorRestoreApply({
      restore,
      now: 10,
      hasUserScrolled: false,
      metrics: { scrollHeight: 1_100, clientHeight: 100 },
    });
    expect(first.applyTop).toBe(500);

    // Same height (repeated measurement / same ratio) must stay idempotent.
    const repeated = planAnchorRestoreApply({
      restore: first.restore,
      now: 20,
      hasUserScrolled: false,
      metrics: { scrollHeight: 1_100, clientHeight: 100 },
    });
    expect(repeated.applyTop).toBeNull();
    expect(repeated.restore.lastAppliedMaxScroll).toBe(1_000);

    // An image/webfont growing the content re-applies the same ratio.
    const grew = planAnchorRestoreApply({
      restore: repeated.restore,
      now: 30,
      hasUserScrolled: false,
      metrics: { scrollHeight: 2_100, clientHeight: 100 },
    });
    expect(grew.applyTop).toBe(1_000);
  });

  it('waits while the content is not scrollable instead of applying at the top', () => {
    const restore = startAnchorRestore({ partId: 'p1', ratio: 0.5, now: 0 })!;
    const unmeasured = planAnchorRestoreApply({
      restore,
      now: 10,
      hasUserScrolled: false,
      metrics: { scrollHeight: 100, clientHeight: 100 },
    });
    expect(unmeasured.applyTop).toBeNull();
    expect(unmeasured.restore.status).toBe('restoring');
  });

  it('cancels for reader scroll intent and never fights a later height change', () => {
    const restore = startAnchorRestore({ partId: 'p1', ratio: 0.5, now: 0 })!;
    const cancelled = planAnchorRestoreApply({
      restore,
      now: 10,
      hasUserScrolled: true,
      metrics: { scrollHeight: 2_100, clientHeight: 100 },
    });
    expect(cancelled.restore.status).toBe('cancelled');
    expect(cancelled.applyTop).toBeNull();
    expect(isAnchorRestorePending(cancelled.restore, 10)).toBe(false);

    const after = planAnchorRestoreApply({
      restore: cancelled.restore,
      now: 20,
      hasUserScrolled: false,
      metrics: { scrollHeight: 3_100, clientHeight: 100 },
    });
    expect(after.applyTop).toBeNull();
  });

  it('suppresses lifecycle persistence while a restore owns the scroll position', () => {
    expect(
      resolveAnchorFlushRatio({
        containerRatio: 0.6,
        pendingRatio: null,
        lastFlushedRatio: null,
        isRestorePending: true,
      }),
    ).toBeNull();
    expect(
      resolveAnchorFlushRatio({
        containerRatio: 0.6,
        pendingRatio: 0.4,
        lastFlushedRatio: null,
        isRestorePending: true,
      }),
    ).toBeNull();
    expect(
      resolveAnchorFlushRatio({
        containerRatio: 0.6,
        pendingRatio: null,
        lastFlushedRatio: null,
        isRestorePending: false,
      }),
    ).toBe(0.6);
  });
});

describe('reader scroll intent key', () => {
  it('accepts only the keys that scroll the reading column', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']) {
      expect(isReaderScrollIntentKey({ key })).toBe(true);
    }
    expect(isReaderScrollIntentKey({ key: 'a' })).toBe(false);
    expect(isReaderScrollIntentKey({ key: 'Enter' })).toBe(false);
    expect(isReaderScrollIntentKey({ key: 'Tab' })).toBe(false);
    expect(isReaderScrollIntentKey({ key: 'Escape' })).toBe(false);
  });

  it('treats Space as scroll intent only without command modifiers', () => {
    expect(isReaderScrollIntentKey({ key: ' ' })).toBe(true);
    expect(isReaderScrollIntentKey({ key: ' ', shiftKey: true })).toBe(true);
    expect(isReaderScrollIntentKey({ key: ' ', ctrlKey: true })).toBe(false);
    expect(isReaderScrollIntentKey({ key: ' ', altKey: true })).toBe(false);
    expect(isReaderScrollIntentKey({ key: ' ', metaKey: true })).toBe(false);
  });

  it('ignores scroll keys owned by an interactive or editable target', () => {
    // Space on a focused button/link must activate, not cancel the restore.
    expect(isReaderScrollIntentKey({ key: ' ', isInteractiveTarget: true })).toBe(false);
    expect(isReaderScrollIntentKey({ key: ' ', shiftKey: true, isInteractiveTarget: true })).toBe(false);
    expect(isReaderScrollIntentKey({ key: 'ArrowDown', isInteractiveTarget: true })).toBe(false);
    expect(isReaderScrollIntentKey({ key: 'PageDown', isInteractiveTarget: true })).toBe(false);
    expect(isReaderScrollIntentKey({ key: 'Home', isInteractiveTarget: true })).toBe(false);

    // Plain reading-column targets keep the existing scroll behavior.
    expect(isReaderScrollIntentKey({ key: ' ', isInteractiveTarget: false })).toBe(true);
    expect(isReaderScrollIntentKey({ key: 'ArrowDown', isInteractiveTarget: false })).toBe(true);
    expect(isReaderScrollIntentKey({ key: 'ArrowDown' })).toBe(true);
  });
});

describe('releaseAnchorRestoreMarkers', () => {
  const inFlight = (partId: string) => startAnchorRestore({ partId, ratio: 0.5, now: 0 })!;

  it('releases an in-flight restore so a Strict Mode effect replay can re-attach', () => {
    expect(releaseAnchorRestoreMarkers({ partId: 'p1', restoredPartId: 'p1', restore: inFlight('p1') })).toEqual({
      restoredPartId: null,
      restore: null,
    });
  });

  it('keeps markers once the restore settled or was cancelled, so deps changes cannot re-apply', () => {
    const settled = planAnchorRestoreApply({
      restore: inFlight('p1'),
      now: READER_ANCHOR_RESTORE_SETTLE_MS,
      hasUserScrolled: false,
      metrics: { scrollHeight: 0, clientHeight: 0 },
    }).restore;
    expect(releaseAnchorRestoreMarkers({ partId: 'p1', restoredPartId: 'p1', restore: settled })).toEqual({
      restoredPartId: 'p1',
      restore: settled,
    });

    const cancelled = planAnchorRestoreApply({
      restore: inFlight('p1'),
      now: 1,
      hasUserScrolled: true,
      metrics: { scrollHeight: 0, clientHeight: 0 },
    }).restore;
    expect(releaseAnchorRestoreMarkers({ partId: 'p1', restoredPartId: 'p1', restore: cancelled })).toEqual({
      restoredPartId: 'p1',
      restore: cancelled,
    });
  });

  it("never releases another part's marker", () => {
    const other = inFlight('p2');
    const forOtherPart = releaseAnchorRestoreMarkers({ partId: 'p1', restoredPartId: 'p1', restore: other });
    expect(forOtherPart.restoredPartId).toBe('p1');
    expect(forOtherPart.restore).toBe(other);

    expect(releaseAnchorRestoreMarkers({ partId: 'p1', restoredPartId: 'p2', restore: null })).toEqual({
      restoredPartId: 'p2',
      restore: null,
    });
  });
});

describe('readerFontSizeAriaLabel', () => {
  it('maps reader font sizes to localized aria labels without exposing tokens', () => {
    expect(readerFontSizeAriaLabel('sm', DEFAULT_LOCALE)).toBe('字号：小');
    expect(readerFontSizeAriaLabel('md', DEFAULT_LOCALE)).toBe('字号：中');
    expect(readerFontSizeAriaLabel('lg', DEFAULT_LOCALE)).toBe('字号：大');
    expect(readerFontSizeAriaLabel('sm', 'en-US')).toBe('Font size: Small');
    expect(readerFontSizeAriaLabel('md', 'en-US')).toBe('Font size: Medium');
    expect(readerFontSizeAriaLabel('lg', 'en-US')).toBe('Font size: Large');
  });
});

describe('formatPhoneticRoleLabel', () => {
  it('returns localized short accent labels', () => {
    expect(formatPhoneticRoleLabel('us', DEFAULT_LOCALE)).toBe('美');
    expect(formatPhoneticRoleLabel('uk', DEFAULT_LOCALE)).toBe('英');
    expect(formatPhoneticRoleLabel('us', 'en-US')).toBe('US');
    expect(formatPhoneticRoleLabel('uk', 'en-US')).toBe('UK');
  });
});

describe('formatInlineAssistPrompt', () => {
  it('preserves zh-CN inline assist prefixes', () => {
    expect(formatInlineAssistPrompt(DEFAULT_LOCALE, 'translate', 'hello')).toBe('翻译：hello');
    expect(formatInlineAssistPrompt(DEFAULT_LOCALE, 'explain', 'hello')).toBe('解释：hello');
    expect(formatInlineAssistPrompt(DEFAULT_LOCALE, 'ask', 'hello', 'What?')).toBe('What?');
    expect(formatInlineAssistPrompt(DEFAULT_LOCALE, 'ask', 'hello')).toBe('询问：hello');
  });

  it('localizes inline assist prefixes for en-US', () => {
    expect(formatInlineAssistPrompt('en-US', 'translate', 'hello')).toBe('Translate: hello');
    expect(formatInlineAssistPrompt('en-US', 'explain', 'hello')).toBe('Explain: hello');
    expect(formatInlineAssistPrompt('en-US', 'ask', 'hello')).toBe('Ask: hello');
  });
});

describe('formatDictionaryWordDeepDivePrompt', () => {
  it('embeds the word in localized deep-dive prompts', () => {
    expect(formatDictionaryWordDeepDivePrompt('ocean', DEFAULT_LOCALE)).toContain('ocean');
    expect(formatDictionaryWordDeepDivePrompt('ocean', 'en-US')).toContain('ocean');
  });
});
