import { afterEach, describe, expect, it, vi } from 'vitest';

import { getClientLocale, LOCALE_COOKIE_NAME, setClientLocaleCookie } from './client-locale';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('locale switch behavior', () => {
  it('switches active locale from zh-CN to en-US via cookie write', () => {
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

    expect(getClientLocale()).toBe('zh-CN');

    setClientLocaleCookie('en-US');

    expect(getClientLocale()).toBe('en-US');
    expect(cookie.startsWith(`${LOCALE_COOKIE_NAME}=en-US`)).toBe(true);
  });

  it('does not overwrite an explicit Accept-Language header when cookie is set', () => {
    expect(
      getClientLocale({
        cookieValue: 'en-US',
        acceptLanguage: 'zh-CN,zh;q=0.9',
      }),
    ).toBe('en-US');
  });
});
