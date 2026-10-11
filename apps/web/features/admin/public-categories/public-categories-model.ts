import { type Locale, SUPPORTED_LOCALES, t } from '@gloaming/i18n';
import {
  isPublicCategoryTranslationMissing,
  normalizePublicCategoryName,
  PUBLIC_CATEGORY_ASSIGNMENT_LIMIT,
  type PublicCategoryManagementItem,
  type PublicCategoryProvenance,
  resolvePublicCategoryName,
  type SourceRecordItem,
} from '@gloaming/shared/discovery';
import { buildPaginationMeta, DEFAULT_PAGE, type PaginationMeta } from '@gloaming/shared/pagination';

/** Bounded client-side page size over the full admin category list. */
export const PUBLIC_CATEGORY_ADMIN_PAGE_SIZE = 8;

/** Server page size for one category's assigned SourceRecords. */
export const PUBLIC_CATEGORY_RECORD_PAGE_SIZE = 10;

/** Server page size for the assignable SourceRecord candidate search. */
export const PUBLIC_CATEGORY_ASSIGNMENT_SEARCH_SIZE = 6;

/** Do not query the candidate endpoint before this many characters. */
export const PUBLIC_CATEGORY_ASSIGNMENT_SEARCH_MIN_CHARS = 2;

/**
 * Stable API error codes (they double as i18n keys). A manual create/PATCH that
 * collides with another category's normalized label for the same locale returns
 * this code, so the UI can surface a uniqueness error instead of a generic one.
 */
export const PUBLIC_CATEGORY_NAME_EXISTS_CODE = 'api.errors.discovery.publicCategoryNameExists';
export const PUBLIC_CATEGORY_LIMIT_EXCEEDED_CODE = 'api.errors.discovery.publicCategoryLimitExceeded';

/** The admin SourceRecord list needs an explicit sort; keep it stable for the admin view. */
export const PUBLIC_CATEGORY_RECORD_SORT_BY = 'sourceUpdatedAt' as const;

const PROVENANCE_KEYS: Record<PublicCategoryProvenance, string> = {
  manual: 'admin.publicCategories.provenance.manual',
  ai: 'admin.publicCategories.provenance.ai',
};

const LOCALE_LABEL_KEYS: Record<Locale, string> = {
  'zh-CN': 'nav.localeZhCN',
  'en-US': 'nav.localeEnUS',
};

/** Human label for a supported locale tag, localized for the current UI locale. */
export function localeDisplayLabel(target: string, uiLocale: Locale): string {
  const key = LOCALE_LABEL_KEYS[target as Locale];
  return key ? t(uiLocale, key) : target;
}

/** i18n key for a category's creation provenance (manual vs AI). */
export function categoryProvenanceKey(provenance: PublicCategoryProvenance): string {
  return PROVENANCE_KEYS[provenance];
}

/**
 * Safe admin display name for the current locale: requested locale → canonical
 * locale → first available label, then the stable id when a category somehow has
 * no label at all. Reuses the shared resolution order so admin and Discover never
 * disagree about which label wins.
 */
export function categoryDisplayName(category: PublicCategoryManagementItem, locale: Locale): string {
  return resolvePublicCategoryName(category, locale)?.trim() || category.id;
}

/**
 * Case-insensitive, whitespace-folded search across the resolved current-locale
 * name, every localized label, and the stable id. Folding reuses the same key as
 * duplicate detection so `  Sci-Fi ` matches `sci-fi`.
 */
export function matchesPublicCategorySearch(
  category: PublicCategoryManagementItem,
  locale: Locale,
  term: string,
): boolean {
  const needle = normalizePublicCategoryName(term);
  if (!needle) {
    return true;
  }
  const haystacks = [
    categoryDisplayName(category, locale),
    category.id,
    ...Object.values(category.localizedNames ?? {}),
  ];
  return haystacks.some((value) => normalizePublicCategoryName(value).includes(needle));
}

/** Filter the full admin list by search term (no term keeps every category). */
export function filterPublicCategories(
  categories: readonly PublicCategoryManagementItem[],
  locale: Locale,
  term: string,
): PublicCategoryManagementItem[] {
  return categories.filter((category) => matchesPublicCategorySearch(category, locale, term));
}

/** Stable display order for the client-side list; the admin API returns a load order. */
export function sortPublicCategories(
  categories: readonly PublicCategoryManagementItem[],
  locale: Locale,
): PublicCategoryManagementItem[] {
  return [...categories].sort(
    (a, b) =>
      categoryDisplayName(a, locale).localeCompare(categoryDisplayName(b, locale), locale) || a.id.localeCompare(b.id),
  );
}

export function clampPublicCategoryPage(page: number, totalPages: number): number {
  if (totalPages <= 0) {
    return DEFAULT_PAGE;
  }
  return Math.min(Math.max(Math.trunc(page), DEFAULT_PAGE), totalPages);
}

/**
 * Client-side pagination over the already-fetched category list. The page is
 * clamped to the available range so a shrinking list never shows a blank page.
 */
export function paginatePublicCategories(
  categories: readonly PublicCategoryManagementItem[],
  page: number,
  pageSize = PUBLIC_CATEGORY_ADMIN_PAGE_SIZE,
): { items: PublicCategoryManagementItem[]; pagination: PaginationMeta } {
  const size = Math.max(1, Math.trunc(pageSize));
  const pagination = buildPaginationMeta({
    page,
    pageSize: size,
    total: categories.length,
    sortBy: 'name',
    sortOrder: 'asc',
  });
  const currentPage = clampPublicCategoryPage(page, pagination.totalPages);
  const start = (currentPage - 1) * size;
  return {
    items: categories.slice(start, start + size),
    pagination: { ...pagination, page: currentPage },
  };
}

/** Keep the current selection when it still exists, otherwise fall back to the first id. */
export function resolveSelectedCategoryId(
  categories: readonly PublicCategoryManagementItem[],
  selectedId: string | null,
): string | null {
  if (selectedId && categories.some((category) => category.id === selectedId)) {
    return selectedId;
  }
  return categories[0]?.id ?? null;
}

export type CategoryLocaleLabelEntry = {
  locale: Locale;
  /** Stored label for that locale, or null when the locale is untranslated. */
  name: string | null;
  isMissing: boolean;
  /** `manual` labels are protected from automatic overwrite. */
  isManual: boolean;
};

/** One row per supported locale so an operator can add or edit every label. */
export function categoryLocaleLabelEntries(category: PublicCategoryManagementItem): CategoryLocaleLabelEntry[] {
  const manualLocales = new Set(category.manualLocales ?? []);
  return SUPPORTED_LOCALES.map((locale) => ({
    locale,
    name: category.localizedNames?.[locale] ?? null,
    isMissing: isPublicCategoryTranslationMissing(category, locale),
    isManual: manualLocales.has(locale),
  }));
}

/** Supported locales with no stored label yet. */
export function missingCategoryLocales(category: PublicCategoryManagementItem): Locale[] {
  return categoryLocaleLabelEntries(category)
    .filter((entry) => entry.isMissing)
    .map((entry) => entry.locale);
}

export function isCategoryFullyLocalized(category: PublicCategoryManagementItem): boolean {
  return missingCategoryLocales(category).length === 0;
}

/** Comma-joined author names; empty string when the source has no authors. */
export function sourceRecordAuthorNames(record: Pick<SourceRecordItem, 'authors'>): string {
  return record.authors
    .map((author) => author.name.trim())
    .filter(Boolean)
    .join(', ');
}

/** True when this exact SourceRecord already carries the category. */
export function isCategoryAssignedToRecord(record: Pick<SourceRecordItem, 'categories'>, categoryId: string): boolean {
  return (record.categories ?? []).some((category) => category.id === categoryId);
}

/**
 * Assignment is capped by the Discovery service; the UI disables the action when
 * the record already holds the product limit or the pair already exists.
 */
export function canAssignCategoryToRecord(record: Pick<SourceRecordItem, 'categories'>, categoryId: string): boolean {
  if (isCategoryAssignedToRecord(record, categoryId)) {
    return false;
  }
  return (record.categories ?? []).length < PUBLIC_CATEGORY_ASSIGNMENT_LIMIT;
}

/** Assignable-candidate search is explicit: it only runs above the minimum length. */
export function normalizeAssignmentSearchTerm(term: string): string {
  return term.trim();
}

export function isAssignmentSearchReady(term: string): boolean {
  return normalizeAssignmentSearchTerm(term).length >= PUBLIC_CATEGORY_ASSIGNMENT_SEARCH_MIN_CHARS;
}
