import { type Locale } from '@gloaming/i18n';
import { resolveLocalizedText, type TaxonomyReference } from '@gloaming/shared/taxonomy';

/** Catalog membership relative to the reader's shelf. */
export type DiscoverShelfStatus = 'available' | 'on_shelf' | 'in_progress';

export type DiscoverItem = {
  id: string;
  title: string;
  author: string;
  /** ReadingPart count for compact catalog cards. */
  partCount: number;
  tags: TaxonomyReference[];
  /** `/api/assets/:id` or null when the work has no cover. */
  coverImageUrl: string | null;
  publishedAt: string;
  shelfStatus: DiscoverShelfStatus;
  progressRatio: number | null;
};

/** 3 rows × 5 columns on large screens. */
export const DISCOVER_PAGE_SIZE = 15;

/** Locale-neutral sentinel for the “all tags” filter chip. */
export const DISCOVER_ALL_TAG = '__all__' as const;
/** Stable taxonomy id, or {@link DISCOVER_ALL_TAG}. */
export type DiscoverTagFilter = typeof DISCOVER_ALL_TAG | string;

export function taxonomyDisplayName(ref: TaxonomyReference, locale: Locale): string {
  return resolveLocalizedText(ref.names, locale);
}

/** Stable WorkCover tint seeds — taxonomy ids, not locale-specific labels. */
export function taxonomyCoverTintSeeds(refs: readonly TaxonomyReference[]): string[] {
  return refs.map((ref) => ref.id);
}

/** Catalog tag query — backend matches normalizeTag against the canonical English label when present. */
export function catalogTagQueryValue(ref: TaxonomyReference): string {
  const en = resolveLocalizedText(ref.names, 'en-US');
  if (en) {
    return en;
  }
  return resolveLocalizedText(ref.names, 'zh-CN');
}
