'use client';

import { useState } from 'react';

import { t } from '@/i18n';
import type { DiscoveryFacet } from '@/shared/discovery';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

type DiscoverFacetsProps = {
  facets: DiscoveryFacet[];
  selectedFacetId: string | null;
  onSelect: (facetId: string | null) => void;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
};

const chipClassName = (isActive: boolean) =>
  cn(
    'inline-flex h-8 items-center rounded-full border px-3.5 text-sm transition-colors duration-200 ease-out-soft',
    'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
    isActive
      ? 'border-transparent bg-accent font-medium text-accent-foreground'
      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
  );

/** Source-native facet chips (Gutenberg Category bookshelves). */
export function DiscoverFacets({
  facets,
  selectedFacetId,
  onSelect,
  isLoading = false,
  isError = false,
  onRetry,
}: DiscoverFacetsProps) {
  const { locale } = useLocale();
  const [isExpanded, setExpanded] = useState(false);

  if (isLoading) {
    return (
      <div className="flex flex-wrap gap-2" aria-hidden>
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-8 w-20 rounded-full bg-surface-container-high" />
        ))}
      </div>
    );
  }

  if (isError && facets.length === 0) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">{t(locale, 'content.discover.loadFailed')}</span>
        {onRetry ? (
          <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={onRetry}>
            {t(locale, 'content.common.retry')}
          </Button>
        ) : null}
      </div>
    );
  }

  if (facets.length === 0) return null;

  const visible = isExpanded ? facets : facets.slice(0, 12);

  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={chipClassName(selectedFacetId === null)} onClick={() => onSelect(null)}>
        {t(locale, 'content.discover.allCategories')}
      </button>
      {visible.map((facet) => (
        <button
          key={facet.id}
          type="button"
          className={chipClassName(selectedFacetId === facet.id)}
          onClick={() => onSelect(facet.id)}
        >
          {facet.name}
        </button>
      ))}
      {facets.length > 12 ? (
        <button type="button" className={chipClassName(false)} onClick={() => setExpanded((value) => !value)}>
          {t(locale, isExpanded ? 'content.discover.fewerCategories' : 'content.discover.moreCategories')}
        </button>
      ) : null}
    </div>
  );
}
