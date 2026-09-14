import { afterEach, describe, expect, it, vi } from 'vitest';

import { getClientLocale, LOCALE_COOKIE_NAME } from './client-locale';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getClientLocale', () => {
  it('falls back to zh-CN when cookie and browser language are unavailable', () => {
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('navigator', { language: '' });

    expect(getClientLocale()).toBe('zh-CN');
  });

  it('prefers locale cookie over browser language', () => {
    vi.stubGlobal('document', { cookie: `${LOCALE_COOKIE_NAME}=en-US` });
    vi.stubGlobal('navigator', { language: 'zh-CN' });

    expect(getClientLocale()).toBe('en-US');
  });

  it('uses browser language when cookie is missing', () => {
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('navigator', { language: 'en-GB' });

    expect(getClientLocale()).toBe('en-US');
  });

  it('accepts an explicit cookie header for non-DOM environments', () => {
    expect(getClientLocale({ cookieHeader: `${LOCALE_COOKIE_NAME}=en-US; other=1` })).toBe('en-US');
  });
});
