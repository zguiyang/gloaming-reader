import { DEFAULT_LOCALE, type Locale, resolveLocale } from '@gloaming/i18n';

/** Cookie name for persisted UI locale preference. */
export const LOCALE_COOKIE_NAME = 'gloaming.locale';

function readCookie(name: string, cookieHeader?: string | null): string | undefined {
  const source = cookieHeader ?? (typeof document !== 'undefined' ? document.cookie : undefined);
  if (!source) {
    return undefined;
  }

  for (const part of source.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) {
      continue;
    }
    const key = trimmed.slice(0, eq);
    if (key !== name) {
      continue;
    }
    const value = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return undefined;
}

/**
 * Resolve the active client locale from cookie, then browser language, then default.
 */
export function getClientLocale(options?: { cookieHeader?: string | null }): Locale {
  const fromCookie = readCookie(LOCALE_COOKIE_NAME, options?.cookieHeader);
  if (fromCookie) {
    return resolveLocale(fromCookie);
  }

  if (typeof navigator !== 'undefined' && navigator.language) {
    return resolveLocale(navigator.language);
  }

  return DEFAULT_LOCALE;
}
