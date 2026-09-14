import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getClientLocale,
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  LOCALE_COOKIE_NAME,
  setClientLocaleCookie,
} from './client-locale';

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

  it('accepts an explicit cookie value', () => {
    expect(getClientLocale({ cookieValue: 'en-US' })).toBe('en-US');
  });

  it('uses Accept-Language when cookie is missing', () => {
    expect(getClientLocale({ acceptLanguage: 'en-US,en;q=0.9' })).toBe('en-US');
  });

  it('prefers cookie over Accept-Language', () => {
    expect(
      getClientLocale({
        cookieValue: 'zh-CN',
        acceptLanguage: 'en-US,en;q=0.9',
      }),
    ).toBe('zh-CN');
  });
});

describe('setClientLocaleCookie', () => {
  it('writes secure first-party cookie attributes', () => {
    let cookie = '';
    vi.stubGlobal('document', {
      set cookie(value: string) {
        cookie = value;
      },
      get cookie() {
        return cookie;
      },
    });

    setClientLocaleCookie('en-US');

    expect(cookie).toContain(`${LOCALE_COOKIE_NAME}=en-US`);
    expect(cookie).toContain('path=/');
    expect(cookie).toContain(`max-age=${LOCALE_COOKIE_MAX_AGE_SECONDS}`);
    expect(cookie).toContain('SameSite=Lax');
  });

  it('persists locale readable by getClientLocale after write', () => {
    let cookie = '';
    vi.stubGlobal('document', {
      set cookie(value: string) {
        cookie = value;
      },
      get cookie() {
        return cookie;
      },
    });
    vi.stubGlobal('navigator', { language: 'zh-CN' });

    setClientLocaleCookie('en-US');

    expect(getClientLocale()).toBe('en-US');
  });
});
