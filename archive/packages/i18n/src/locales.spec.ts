import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE, resolveLocale, SUPPORTED_LOCALES } from './locales.ts';

describe('resolveLocale', () => {
  it('returns default for empty or unsupported values', () => {
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(null)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale('')).toBe(DEFAULT_LOCALE);
    expect(resolveLocale('fr-FR')).toBe(DEFAULT_LOCALE);
  });

  it('matches supported locale tags exactly', () => {
    expect(resolveLocale('zh-CN')).toBe('zh-CN');
    expect(resolveLocale('en-US')).toBe('en-US');
    expect(resolveLocale('zh-cn')).toBe('zh-CN');
    expect(resolveLocale('en_us')).toBe('en-US');
  });

  it('maps language prefixes to supported locales', () => {
    expect(resolveLocale('zh')).toBe('zh-CN');
    expect(resolveLocale('en')).toBe('en-US');
    expect(resolveLocale('en-GB')).toBe('en-US');
  });

  it('honors Accept-Language quality lists in order', () => {
    expect(resolveLocale('fr-FR, en-US;q=0.9, zh-CN;q=0.8')).toBe('en-US');
    expect(resolveLocale('fr-FR, de-DE;q=0.9, zh;q=0.8')).toBe('zh-CN');
  });

  it('keeps supported locales stable', () => {
    expect(SUPPORTED_LOCALES).toEqual(['zh-CN', 'en-US']);
    expect(DEFAULT_LOCALE).toBe('zh-CN');
  });
});
