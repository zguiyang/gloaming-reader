import { DEFAULT_LOCALE, type Locale, resolveLocale } from '@gloaming/i18n';

/** Cookie name for persisted UI locale preference. */
export const LOCALE_COOKIE_NAME = 'gloaming.locale';

/** One year — matches typical UI preference persistence. */
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type ClientLocaleOptions = {
  cookieHeader?: string | null;
  cookieValue?: string | null;
  acceptLanguage?: string | null;
};

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

function readLocaleCookie(options?: ClientLocaleOptions): string | undefined {
  if (options?.cookieValue) {
    return options.cookieValue;
  }
  return readCookie(LOCALE_COOKIE_NAME, options?.cookieHeader);
}

/**
 * Resolve the active client locale from cookie, then Accept-Language / browser language, then default.
 */
export function getClientLocale(options?: ClientLocaleOptions): Locale {
  const fromCookie = readLocaleCookie(options);
  if (fromCookie) {
    return resolveLocale(fromCookie);
  }

  if (options?.acceptLanguage) {
    return resolveLocale(options.acceptLanguage);
  }

  if (typeof navigator !== 'undefined' && navigator.language) {
    return resolveLocale(navigator.language);
  }

  return DEFAULT_LOCALE;
}

/** Persist UI locale in a first-party cookie and reload on the next navigation. */
export function setClientLocaleCookie(locale: Locale): void {
  if (typeof document === 'undefined') {
    return;
  }

  const encoded = encodeURIComponent(locale);
  document.cookie = `${LOCALE_COOKIE_NAME}=${encoded}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}
