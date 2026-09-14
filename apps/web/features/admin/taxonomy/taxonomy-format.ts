import { type Locale, t } from '@gloaming/i18n';
import type { LanguageCode, LocalizedTextMap, TaxonomyItem, TaxonomyOrigin } from '@gloaming/shared/taxonomy';
import { LANGUAGE_CODES, resolveLocalizedText } from '@gloaming/shared/taxonomy';

import { formatAdminDateTime } from '@/features/admin/admin-logs-format';

export type TranslationFilter = 'all' | 'complete' | 'partial';
export type TranslationStatus = 'complete' | 'partial';

export function hasLocaleName(names: LocalizedTextMap | null | undefined, code: LanguageCode): boolean {
  return Boolean(names?.[code]?.trim());
}

export function getTranslationStatus(names: LocalizedTextMap): TranslationStatus {
  return hasLocaleName(names, 'zh-CN') && hasLocaleName(names, 'en-US') ? 'complete' : 'partial';
}

export function formatTaxonomyLocaleCell(names: LocalizedTextMap, code: LanguageCode, locale: Locale): string {
  const value = names[code]?.trim();
  if (value) {
    return value;
  }
  return t(locale, code === 'zh-CN' ? 'admin.taxonomy.panel.missingChinese' : 'admin.taxonomy.panel.missingEnglish');
}

export function formatTranslationStatusLabel(status: TranslationStatus, locale: Locale): string {
  return t(
    locale,
    status === 'complete' ? 'admin.taxonomy.panel.translationComplete' : 'admin.taxonomy.panel.translationPartial',
  );
}

export function formatTaxonomyOrigin(origin: TaxonomyOrigin, locale: Locale): string {
  return t(locale, `admin.content.provenance.${origin}`);
}

export function formatTaxonomyUpdatedAt(value: string | Date, locale: Locale): string {
  return formatAdminDateTime(value, locale);
}

export function matchesTaxonomySearch(item: TaxonomyItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  for (const code of LANGUAGE_CODES) {
    const name = item.names[code]?.trim().toLowerCase();
    if (name?.includes(needle)) {
      return true;
    }
  }
  return false;
}

export function matchesTranslationFilter(item: TaxonomyItem, filter: TranslationFilter): boolean {
  if (filter === 'all') {
    return true;
  }
  const status = getTranslationStatus(item.names);
  return filter === 'complete' ? status === 'complete' : status === 'partial';
}

export function filterTaxonomyItems(
  items: TaxonomyItem[],
  options: { search?: string; translationFilter?: TranslationFilter },
): TaxonomyItem[] {
  const search = options.search?.trim() ?? '';
  const translationFilter = options.translationFilter ?? 'all';

  return items.filter((item) => {
    if (search && !matchesTaxonomySearch(item, search)) {
      return false;
    }
    if (!matchesTranslationFilter(item, translationFilter)) {
      return false;
    }
    return true;
  });
}

export function buildTaxonomyNamesPayload(zhName: string, enName: string): LocalizedTextMap | null {
  const names: LocalizedTextMap = {};
  const zh = zhName.trim();
  const en = enName.trim();
  if (zh) {
    names['zh-CN'] = zh;
  }
  if (en) {
    names['en-US'] = en;
  }
  return Object.keys(names).length > 0 ? names : null;
}

export function formatTaxonomyConfirmName(names: LocalizedTextMap, locale: Locale): string {
  const zh = names['zh-CN']?.trim();
  const en = names['en-US']?.trim();
  if (zh && en) {
    return `${zh} / ${en}`;
  }
  const primary = resolveLocalizedText(names, locale);
  return primary || zh || en || '';
}

export function resolveTaxonomyPrimaryName(names: LocalizedTextMap, locale: Locale): string {
  return resolveLocalizedText(names, locale);
}

/** Secondary label in the other locale — omitted when absent or identical to the primary label. */
export function resolveTaxonomyAuxiliaryName(names: LocalizedTextMap, locale: Locale): string | null {
  const other: LanguageCode = locale === 'zh-CN' ? 'en-US' : 'zh-CN';
  const value = names[other]?.trim();
  if (!value) {
    return null;
  }
  const primary = resolveTaxonomyPrimaryName(names, locale);
  return value === primary ? null : value;
}

export function resolveTaxonomyItemById(items: TaxonomyItem[], id: string): TaxonomyItem | undefined {
  return items.find((item) => item.id === id);
}

export function filterTaxonomyPickerItems(items: TaxonomyItem[], search: string): TaxonomyItem[] {
  return filterTaxonomyItems(items, { search });
}
