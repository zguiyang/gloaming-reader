'use client';

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

import { t } from '@/i18n';

import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

type DiscoverPaginationProps = {
  page: number;
  hasMore: boolean;
  onPageChange: (page: number) => void;
};

/**
 * Prev / current / next only. Discover catalogs are too large for page-number
 * windows (thousands of pages); hasMore comes from a pageSize+1 probe.
 */
export function DiscoverPagination({ page, hasMore, onPageChange }: DiscoverPaginationProps) {
  const { locale } = useLocale();
  const hasPrev = page > 1;
  const shouldShowControls = hasPrev || hasMore;

  if (!shouldShowControls) {
    return null;
  }

  const currentLabel = t(locale, 'content.discover.currentPage', { page });

  return (
    <div className="mt-10 mb-4 md:mt-16 md:mb-8">
      <nav
        className="flex items-center justify-center gap-4 md:hidden"
        aria-label={t(locale, 'content.discover.pagination')}
      >
        <Button type="button" variant="outline" disabled={!hasPrev} onClick={() => onPageChange(page - 1)}>
          {t(locale, 'content.discover.prevPage')}
        </Button>
        <span className="text-sm tabular-nums text-muted-foreground" aria-current="page">
          {currentLabel}
        </span>
        <Button type="button" variant="outline" disabled={!hasMore} onClick={() => onPageChange(page + 1)}>
          {t(locale, 'content.discover.nextPage')}
        </Button>
      </nav>

      <nav
        className="hidden items-center justify-center gap-6 font-heading text-lg md:flex"
        aria-label={t(locale, 'content.discover.pagination')}
      >
        <Button
          variant="plain"
          size={null}
          type="button"
          disabled={!hasPrev}
          onClick={() => onPageChange(page - 1)}
          className={cn(
            'inline-flex items-center gap-2 text-muted-foreground transition-colors duration-200 ease-out-soft',
            'hover:text-primary disabled:pointer-events-none disabled:opacity-40',
          )}
        >
          <ChevronLeftIcon className="size-5" strokeWidth={1.5} aria-hidden />
          {t(locale, 'content.discover.prevPage')}
        </Button>
        <span className="tabular-nums text-muted-foreground" aria-current="page">
          {currentLabel}
        </span>
        <Button
          variant="plain"
          size={null}
          type="button"
          disabled={!hasMore}
          onClick={() => onPageChange(page + 1)}
          className={cn(
            'inline-flex items-center gap-2 text-muted-foreground transition-colors duration-200 ease-out-soft',
            'hover:text-primary disabled:pointer-events-none disabled:opacity-40',
          )}
        >
          {t(locale, 'content.discover.nextPage')}
          <ChevronRightIcon className="size-5" strokeWidth={1.5} aria-hidden />
        </Button>
      </nav>
    </div>
  );
}
