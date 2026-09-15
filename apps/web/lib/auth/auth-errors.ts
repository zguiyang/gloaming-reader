/**
 * Stable auth error codes for web branching (Better Auth wire codes).
 */

import { type Locale, t } from '@gloaming/i18n';

import type { AuthError } from './types';

/** Better Auth email-not-verified code. */
export const BA_ERROR_EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED' as const;

export function isEmailNotVerifiedError(code?: string | number | null): boolean {
  return code === BA_ERROR_EMAIL_NOT_VERIFIED;
}

/** BA built-in rate limit — HTTP 429. */
export function isAuthRateLimited(error: { status?: number; code?: string | number } | null): boolean {
  if (!error) {
    return false;
  }
  return error.status === 429 || error.code === 'TOO_MANY_REQUESTS';
}

/**
 * Confirmed Better Auth wire codes mapped to localized copy.
 * Unlisted codes fall back to the caller's feature-specific key.
 */
const AUTH_ERROR_CODE_MESSAGE_KEYS: Record<string, string> = {
  TOO_MANY_REQUESTS: 'auth.errors.tooManyRequests',
  INVALID_PASSWORD: 'auth.errors.invalidPassword',
  INVALID_TOKEN: 'auth.errors.invalidToken',
};

/**
 * Resolve user-facing auth error copy without leaking Better Auth raw messages.
 */
export function resolveAuthErrorMessage(
  error: Pick<AuthError, 'code' | 'status' | 'message'> | null | undefined,
  locale: Locale,
  fallbackKey: string,
): string {
  if (!error) {
    return t(locale, fallbackKey);
  }

  if (isAuthRateLimited(error)) {
    return t(locale, 'auth.errors.tooManyRequests');
  }

  const code = error.code != null ? String(error.code) : undefined;
  if (code) {
    const mappedKey = AUTH_ERROR_CODE_MESSAGE_KEYS[code];
    if (mappedKey) {
      return t(locale, mappedKey);
    }
  }

  return t(locale, fallbackKey);
}
