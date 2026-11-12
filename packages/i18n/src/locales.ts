export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'zh-CN';

const LOCALE_SET = new Set<string>(SUPPORTED_LOCALES);

function normalizeLocaleTag(input: string): string {
  return input.trim().replace(/_/g, '-');
}

function matchSupportedLocale(tag: string): Locale | undefined {
  const normalized = normalizeLocaleTag(tag);
  const lower = normalized.toLowerCase();

  for (const locale of SUPPORTED_LOCALES) {
    if (lower === locale.toLowerCase()) {
      return locale;
    }
  }

  const language = lower.split('-')[0];
  if (language === 'zh') {
    return 'zh-CN';
  }
  if (language === 'en') {
    return 'en-US';
  }

  return undefined;
}

/** Resolve an arbitrary locale tag to a supported locale, falling back to {@link DEFAULT_LOCALE}. */
export function resolveLocale(input: string | null | undefined): Locale {
  if (input == null || input.trim() === '') {
    return DEFAULT_LOCALE;
  }

  const candidates = input
    .split(',')
    .map((part) => part.split(';')[0]?.trim())
    .filter((part): part is string => Boolean(part));

  for (const candidate of candidates) {
    const matched = matchSupportedLocale(candidate);
    if (matched) {
      return matched;
    }
  }

  const direct = matchSupportedLocale(input);
  if (direct) {
    return direct;
  }

  if (LOCALE_SET.has(input)) {
    return input as Locale;
  }

  return DEFAULT_LOCALE;
}
