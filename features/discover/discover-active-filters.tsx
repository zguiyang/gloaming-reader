'use client';

import { XIcon } from 'lucide-react';

import { t } from '@/i18n';

import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/locale-context';

type DiscoverActiveFiltersProps = {
  query: string;
  facetLabel: string | null;
  onClearQuery: () => void;
  onClearFacet: () => void;
};

const filterChipClassName =
  'inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-xs text-foreground transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none';

/** Shows the filters currently narrowing the Discover list and lets the user clear each one. */
export function DiscoverActiveFilters({ query, facetLabel, onClearQuery, onClearFacet }: DiscoverActiveFiltersProps) {
  const { locale } = useLocale();
  const trimmedQuery = query.trim();

  if (!trimmedQuery && !facetLabel) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2" aria-live="polite">
      <span className="text-xs text-muted-foreground">{t(locale, 'content.discover.activeFilters')}</span>
      {facetLabel ? (
        <Button
          variant="plain"
          size={null}
          type="button"
          onClick={onClearFacet}
          className={filterChipClassName}
          aria-label={t(locale, 'content.discover.clearCategoryFilter', { category: facetLabel })}
        >
          {facetLabel}
          <XIcon className="size-3.5" strokeWidth={1.5} aria-hidden />
        </Button>
      ) : null}
      {trimmedQuery ? (
        <Button
          variant="plain"
          size={null}
          type="button"
          onClick={onClearQuery}
          className={filterChipClassName}
          aria-label={t(locale, 'content.discover.clearSearch')}
        >
          {t(locale, 'content.discover.searchFilterChip', { query: trimmedQuery })}
          <XIcon className="size-3.5" strokeWidth={1.5} aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
