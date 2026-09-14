import { t } from '@gloaming/i18n';

import { getClientLocale } from '@/lib/client-locale';

import { isAuthRateLimited } from './auth-errors';

/**
 * Map Better Auth rate-limit errors to UX copy.
 */
export function resolveMailCooldownErrorMessage(error: {
  code?: string | number;
  message?: string | null;
  status?: number;
}): string | null {
  if (isAuthRateLimited(error)) {
    return error.message?.trim() || t(getClientLocale(), 'auth.errors.tooManyRequests');
  }
  return null;
}
