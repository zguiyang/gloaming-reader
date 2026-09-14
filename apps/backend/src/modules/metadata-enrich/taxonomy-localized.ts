import { type Locale, SUPPORTED_LOCALES } from '@gloaming/i18n';
import { mergeLocalizedName, type TaxonomyLocalizedNames } from '@gloaming/shared/taxonomy';

import { areProductTagsWeak } from '@/modules/metadata-fill/subjects';

export type LocalizedNameEntry = { locale: Locale; name: string };

/** Comma-separated supported locales for prompt copy — single source from @gloaming/i18n. */
export function supportedLocalesLabel(): string {
  return SUPPORTED_LOCALES.join(', ');
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
 * Build a localized_names map from model entries. Missing supported locales fall
 * back to `fallbackName` (never invented translations).
 */
export function buildLocalizedNamesMap(entries: LocalizedNameEntry[], fallbackName: string): TaxonomyLocalizedNames {
  let map: TaxonomyLocalizedNames = {};
  for (const { locale, name } of entries) {
    map = mergeLocalizedName(map, locale, name);
  }
  const fallback = fallbackName.trim();
  if (fallback) {
    for (const locale of SUPPORTED_LOCALES) {
      if (!map[locale]?.trim()) {
        map = mergeLocalizedName(map, locale, fallback);
      }
    }
  }
  return map;
}

export function isTaxonomyLocalizationComplete(localizedNames: TaxonomyLocalizedNames | null | undefined): boolean {
  return SUPPORTED_LOCALES.every((locale) => Boolean(localizedNames?.[locale]?.trim()));
}

/** Merge incoming locale names into existing without dropping prior locales. */
export function mergeTaxonomyLocalizedNames(
  existing: TaxonomyLocalizedNames | null | undefined,
  incoming: TaxonomyLocalizedNames,
): TaxonomyLocalizedNames {
  let map = { ...(existing ?? {}) };
  for (const locale of SUPPORTED_LOCALES) {
    const name = incoming[locale]?.trim();
    if (name) {
      map = mergeLocalizedName(map, locale, name);
    }
  }
  return map;
}

export type TaxonomySnapshot = { name: string; localizedNames: TaxonomyLocalizedNames };

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
