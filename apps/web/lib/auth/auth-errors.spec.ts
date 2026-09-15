import { describe, expect, it } from 'vitest';

import {
  BA_ERROR_EMAIL_NOT_VERIFIED,
  isAuthRateLimited,
  isEmailNotVerifiedError,
  resolveAuthErrorMessage,
} from './auth-errors';

describe('auth-errors', () => {
  it('detects Better Auth email-not-verified code', () => {
    expect(isEmailNotVerifiedError(BA_ERROR_EMAIL_NOT_VERIFIED)).toBe(true);
    expect(isEmailNotVerifiedError('OTHER')).toBe(false);
  });

  it('detects BA rate-limit status and code', () => {
    expect(isAuthRateLimited({ status: 429 })).toBe(true);
    expect(isAuthRateLimited({ code: 'TOO_MANY_REQUESTS' })).toBe(true);
    expect(isAuthRateLimited({ status: 400, code: 'OTHER' })).toBe(false);
    expect(isAuthRateLimited(null)).toBe(false);
  });
});

describe('resolveAuthErrorMessage', () => {
  it('maps rate-limit errors to localized copy without leaking raw messages', () => {
    expect(
      resolveAuthErrorMessage({ status: 429, message: 'Too many requests' }, 'en-US', 'auth.errors.signInFailed'),
    ).toBe('Too many requests. Please try again later.');
    expect(
      resolveAuthErrorMessage({ code: 'TOO_MANY_REQUESTS', message: 'nope' }, 'zh-CN', 'auth.errors.sendFailed'),
    ).toBe('请求过于频繁，请稍后再试');
  });

  it('maps confirmed Better Auth codes to localized keys', () => {
    expect(
      resolveAuthErrorMessage(
        { code: 'INVALID_PASSWORD', message: 'Invalid password' },
        'en-US',
        'account.password.failed',
      ),
    ).toBe('Incorrect password.');
    expect(
      resolveAuthErrorMessage({ code: 'INVALID_TOKEN', message: 'Invalid token' }, 'en-US', 'auth.verifyEmail.failed'),
    ).toBe('This link is invalid or has expired.');
  });

  it('uses the caller fallback for unknown codes and ignores raw messages', () => {
    expect(
      resolveAuthErrorMessage(
        { code: 'UNKNOWN_CODE', message: 'Internal Better Auth detail' },
        'en-US',
        'auth.errors.signInFailed',
      ),
    ).toBe('Sign in failed');
    expect(resolveAuthErrorMessage(null, 'zh-CN', 'auth.signOutFailed')).toBe('退出登录失败，请稍后重试');
  });
});
