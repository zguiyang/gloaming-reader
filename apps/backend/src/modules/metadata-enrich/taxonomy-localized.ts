import { type Locale, SUPPORTED_LOCALES } from '@gloaming/i18n';
import {
  LANGUAGE_CODES,
  type LanguageCode,
  type LocalizedTextMap,
  mergeLocalizedText,
} from '@gloaming/shared/taxonomy';

import { areProductTagsWeak } from '@/modules/metadata-fill/subjects';

export type LocalizedNameEntry = { locale: Locale; name: string };

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;

/** Comma-separated supported locales for prompt copy — single source from @gloaming/i18n. */
export function supportedLocalesLabel(): string {
  return SUPPORTED_LOCALES.join(', ');
}

/** Infer the best locale for a single extracted label — never duplicates into both locales. */
export function inferLocaleForLabel(label: string, bookLanguage?: string | null): LanguageCode {
  const trimmed = label.trim();
  if (CJK_RE.test(trimmed)) {
    return 'zh-CN';
  }
  const lang = bookLanguage?.trim().toLowerCase() ?? '';
  if (lang.startsWith('zh') || lang === 'cmn') {
    return 'zh-CN';
  }
  return 'en-US';
}

export function parseLocalizedNameEntries(value: unknown): LocalizedNameEntry[] {
  if (!Array.isArray(value)) return [];
  const out: LocalizedNameEntry[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const localeRaw = typeof row.locale === 'string' ? row.locale : '';
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!name || !SUPPORTED_LOCALES.includes(localeRaw as Locale)) continue;
    if (seen.has(localeRaw)) continue;
    seen.add(localeRaw);
    out.push({ locale: localeRaw as Locale, name: name.slice(0, 100) });
  }
  return out;
}

/**
 * Build a localized_names map from model entries. Only locales present in
 * `entries` are stored. When entries are empty, `fallbackName` is assigned to a
 * single inferred locale — never copied across missing languages.
 */
export function buildLocalizedNamesMap(entries: LocalizedNameEntry[], fallbackName: string): LocalizedTextMap {
  let map: LocalizedTextMap = {};
  for (const { locale, name } of entries) {
    map = mergeLocalizedText(map, locale, name);
  }
  if (Object.keys(map).length === 0) {
    const fallback = fallbackName.trim();
    if (fallback) {
      map = mergeLocalizedText(map, inferLocaleForLabel(fallback), fallback);
    }
  }
  return map;
}

export function isTaxonomyLocalizationComplete(localizedNames: LocalizedTextMap | null | undefined): boolean {
  return LANGUAGE_CODES.every((code) => Boolean(localizedNames?.[code]?.trim()));
}

/** Merge incoming locale names into existing without dropping prior locales. */
export function mergeTaxonomyLocalizedNames(
  existing: LocalizedTextMap | null | undefined,
  incoming: LocalizedTextMap,
): LocalizedTextMap {
  let map = { ...(existing ?? {}) };
  for (const code of LANGUAGE_CODES) {
    const name = incoming[code]?.trim();
    if (name) {
      map = mergeLocalizedText(map, code, name);
    }
  }
  return map;
}

export type TaxonomySnapshot = { name: string; localizedNames: LocalizedTextMap };

/** Weak when empty, catalog-like, or missing any supported locale translation. */
export function areWorkTagsWeak(tags: TaxonomySnapshot[]): boolean {
  if (tags.length === 0) return true;
  if (areProductTagsWeak(tags.map((tag) => tag.name))) return true;
  return tags.some((tag) => !isTaxonomyLocalizationComplete(tag.localizedNames));
}

export function isCategoryWeak(category: TaxonomySnapshot | undefined): boolean {
  if (!category?.name.trim()) return true;
  return !isTaxonomyLocalizationComplete(category.localizedNames);
}
