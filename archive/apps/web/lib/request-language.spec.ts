import { afterEach, describe, expect, it, vi } from 'vitest';

import { LOCALE_COOKIE_NAME } from './client-locale';
import { applyRequestLocale } from './request-language';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('applyRequestLocale', () => {
  it('sets Accept-Language from default locale when absent', () => {
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('navigator', { language: '' });

    const headers = applyRequestLocale({ Accept: 'application/json' });

    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('Accept-Language')).toBe('zh-CN');
  });

  it('sets Accept-Language from locale cookie', () => {
    vi.stubGlobal('document', { cookie: `${LOCALE_COOKIE_NAME}=en-US` });

    const headers = applyRequestLocale();

    expect(headers.get('Accept-Language')).toBe('en-US');
  });

  it('preserves explicit Accept-Language override', () => {
    const headers = applyRequestLocale({ 'Accept-Language': 'fr-FR' });

    expect(headers.get('Accept-Language')).toBe('fr-FR');
  });
});
