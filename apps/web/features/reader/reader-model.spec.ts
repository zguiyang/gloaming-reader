import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE } from '@gloaming/i18n';

import {
  DEFAULT_READER_PLAYBACK_RATE,
  formatDictionaryWordDeepDivePrompt,
  formatInlineAssistPrompt,
  formatPhoneticRoleLabel,
  formatPlaybackRate,
  formatReaderChapterTitle,
  isCurrentChapter,
  nextPlaybackRate,
  READER_PLAYBACK_RATES,
  readerFontSizeAriaLabel,
  type ReaderPlaybackRate,
  resolveAudioRole,
} from '@/features/reader/reader-model';

describe('isCurrentChapter', () => {
  it('matches only the open part id', () => {
    expect(isCurrentChapter('a', 'a')).toBe(true);
    expect(isCurrentChapter('a', 'b')).toBe(false);
  });
});

describe('resolveAudioRole', () => {
  it('prefers us then uk when no preference', () => {
    expect(resolveAudioRole({ us: true, uk: true })).toBe('us');
    expect(resolveAudioRole({ us: false, uk: true })).toBe('uk');
    expect(resolveAudioRole({ us: false, uk: false })).toBeNull();
  });

  it('honors preference when available, otherwise falls back', () => {
    expect(resolveAudioRole({ us: true, uk: true }, 'uk')).toBe('uk');
    expect(resolveAudioRole({ us: true, uk: false }, 'uk')).toBe('us');
  });

  /** ReaderTts shows the US/UK segment only when both roles are API-available. */
  it('requires both accents available before accent switching is offered', () => {
    const shouldOfferAccentSwitch = (available: { us: boolean; uk: boolean }) => available.us && available.uk;
    expect(shouldOfferAccentSwitch({ us: true, uk: true })).toBe(true);
    expect(shouldOfferAccentSwitch({ us: true, uk: false })).toBe(false);
    expect(shouldOfferAccentSwitch({ us: false, uk: false })).toBe(false);
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
