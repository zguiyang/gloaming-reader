import type { Locale } from '@gloaming/i18n';
import type { TaxonomyReference, TaxonomySelection } from '@gloaming/shared/taxonomy';

import { resolveTaxonomyPrimaryName } from '@/features/admin/taxonomy/taxonomy-format';

export function taxonomyReferenceIds(refs: readonly { id: string }[]): string[] {
  return refs.map((ref) => ref.id);
}

export function toTaxonomySelections(ids: readonly string[]): TaxonomySelection[] {
  return ids.map((id) => ({ id }));
}

export function toTaxonomySelection(id: string | null | undefined): TaxonomySelection | null {
  if (!id) {
    return null;
  }
  return { id };
}

export function categoryReferenceId(category: TaxonomyReference | null | undefined): string | null {
  return category?.id ?? null;
}

/** Locale-aware primary label for preview surfaces — cross-locale fallback is display-only. */
export function formatWorkTaxonomyLabel(ref: TaxonomyReference, locale: Locale): string {
  const label = resolveTaxonomyPrimaryName(ref.names, locale);
  return label || ref.id;
}

export function categoryReviewItems(category: TaxonomyReference | null | undefined): TaxonomyReference[] {
  return category ? [category] : [];
}
