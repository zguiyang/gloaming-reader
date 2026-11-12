// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AUTH_ROUTES } from '@/constants';
import {
  clearAuthReturnPath,
  consumePostAuthPath,
  peekAuthReturnPath,
  readReturnPathFromSearchParams,
  rememberAuthReturnPath,
  resolvePostAuthPath,
  resolveSocialAuthErrorPath,
} from '@/lib/auth/post-auth-redirect';

describe('post-auth redirect', () => {
  beforeEach(() => {
    clearAuthReturnPath();
  });

  afterEach(() => {
    clearAuthReturnPath();
  });

  it('prefers returnTo and returnPath query params when safe', () => {
    expect(readReturnPathFromSearchParams(new URLSearchParams('returnTo=/discover'))).toBe('/discover');
    expect(readReturnPathFromSearchParams(new URLSearchParams('returnPath=/read/work-1?part=p1'))).toBe(
      '/read/work-1?part=p1',
    );
    expect(readReturnPathFromSearchParams(new URLSearchParams('returnTo=//evil.test'))).toBeNull();
    expect(readReturnPathFromSearchParams(new URLSearchParams('returnTo=/verify-email'))).toBeNull();
  });

  it('stores the current path but skips landing and auth routes', () => {
    rememberAuthReturnPath('/library');
    expect(peekAuthReturnPath()).toBe('/library');

    clearAuthReturnPath();
    rememberAuthReturnPath('/');
    expect(peekAuthReturnPath()).toBeNull();
  });

  it('resolves to Library by default and consumes stored paths once', () => {
    rememberAuthReturnPath('/reading-history');
    expect(resolvePostAuthPath()).toBe('/reading-history');
    expect(consumePostAuthPath()).toBe('/reading-history');
    expect(peekAuthReturnPath()).toBeNull();
    expect(resolvePostAuthPath()).toBe(AUTH_ROUTES.library);
  });

  it('prefers explicit query params over stored paths', () => {
    rememberAuthReturnPath('/library');
    const params = new URLSearchParams('returnTo=/discover/book-1');
    expect(consumePostAuthPath(params)).toBe('/discover/book-1');
    expect(peekAuthReturnPath()).toBeNull();
  });

  it('builds a same-origin social auth error path with a safe return target', () => {
    rememberAuthReturnPath('/discover/book-1?from=library');
    expect(resolveSocialAuthErrorPath()).toBe(
      `${AUTH_ROUTES.socialAuthError}?returnTo=${encodeURIComponent('/discover/book-1?from=library')}`,
    );
  });
});
