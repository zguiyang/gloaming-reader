'use client';

import { XIcon } from 'lucide-react';

import { t } from '@gloaming/i18n';

import { useLocale } from '@/lib/locale-context';

type DiscoverActiveFiltersProps = {
  query: string;
  categoryLabel: string | null;
  onClearQuery: () => void;
  onClearCategory: () => void;
};

const filterChipClassName =
  'inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-xs text-foreground transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none';

/** Shows the filters currently narrowing the Discover list and lets the user clear each one. */
export function DiscoverActiveFilters({
  query,
  categoryLabel,
  onClearQuery,
  onClearCategory,
}: DiscoverActiveFiltersProps) {
  const { locale } = useLocale();
  const trimmedQuery = query.trim();

  if (!trimmedQuery && !categoryLabel) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2" aria-live="polite">
      <span className="text-xs text-muted-foreground">{t(locale, 'content.discover.activeFilters')}</span>
      {categoryLabel ? (
        <button
          type="button"
          onClick={onClearCategory}
          className={filterChipClassName}
          aria-label={t(locale, 'content.discover.clearCategoryFilter', { category: categoryLabel })}
        >
          {categoryLabel}
          <XIcon className="size-3.5" strokeWidth={1.5} aria-hidden />
        </button>
      ) : null}
      {trimmedQuery ? (
        <button
          type="button"
          onClick={onClearQuery}
          className={filterChipClassName}
          aria-label={t(locale, 'content.discover.clearSearch')}
        >
          {t(locale, 'content.discover.searchFilterChip', { query: trimmedQuery })}
          <XIcon className="size-3.5" strokeWidth={1.5} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
