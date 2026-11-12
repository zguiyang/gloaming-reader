import { DEFAULT_LOCALE, type Locale } from './locales.ts';
import { messages } from './messages.ts';

export type TranslationParams = Record<string, string | number>;

function getNestedString(source: Record<string, unknown>, key: string): string | undefined {
  const segments = key.split('.');
  let current: unknown = source;

  for (const segment of segments) {
    if (current == null || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return typeof current === 'string' ? current : undefined;
}

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

function lookupMessage(locale: Locale, key: string): string | undefined {
  return getNestedString(messages[locale], key);
}

/**
 * Translate a dot-separated message key for the given locale.
 * Falls back to {@link DEFAULT_LOCALE} when the key is missing in the requested locale.
 * Returns the key itself when no translation exists.
 */
export function t(locale: Locale, key: string, params?: TranslationParams): string {
  const primary = lookupMessage(locale, key);
  if (primary !== undefined) {
    return interpolate(primary, params);
  }

  if (locale !== DEFAULT_LOCALE) {
    const fallback = lookupMessage(DEFAULT_LOCALE, key);
    if (fallback !== undefined) {
      return interpolate(fallback, params);
    }
  }

  return key;
}
