'use client';

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

import { t } from '@gloaming/i18n';

import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

type DiscoverPaginationProps = {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** Mobile: show load-more instead of page numbers when more remain. */
  hasMoreMobile: boolean;
  onLoadMore: () => void;
};

export function DiscoverPagination({
  page,
  totalPages,
  onPageChange,
  hasMoreMobile,
  onLoadMore,
}: DiscoverPaginationProps) {
  const { locale } = useLocale();

  if (totalPages <= 1 && !hasMoreMobile) {
    return null;
  }

  const pages = Array.from({ length: totalPages }, (_, index) => index + 1);

  return (
    <div className="mt-10 mb-4 md:mt-16 md:mb-8">
      {hasMoreMobile ? (
        <div className="flex justify-center md:hidden">
          <Button
            type="button"
            variant="outline"
            className="h-10 rounded-full border-border px-6 text-sm text-muted-foreground hover:border-primary hover:text-primary"
            onClick={onLoadMore}
          >
            {t(locale, 'content.discover.loadMore')}
          </Button>
        </div>
      ) : null}

      {totalPages > 1 ? (
        <nav
          className="hidden items-center justify-center gap-6 font-heading text-lg md:flex"
          aria-label={t(locale, 'content.discover.pagination')}
        >
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className={cn(
              'inline-flex items-center gap-2 text-muted-foreground transition-colors duration-200 ease-out-soft',
              'hover:text-primary disabled:pointer-events-none disabled:opacity-40',
            )}
          >
            <ChevronLeftIcon className="size-5" strokeWidth={1.5} aria-hidden />
            {t(locale, 'content.discover.prevPage')}
          </button>
          <div className="flex items-center gap-4 text-muted-foreground">
            {pages.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onPageChange(n)}
                aria-current={n === page ? 'page' : undefined}
                className={cn(
                  'pb-1 transition-colors duration-200 ease-out-soft hover:text-primary',
                  n === page && 'border-b border-primary font-semibold text-primary',
                )}
              >
                {n}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className={cn(
              'inline-flex items-center gap-2 text-muted-foreground transition-colors duration-200 ease-out-soft',
              'hover:text-primary disabled:pointer-events-none disabled:opacity-40',
            )}
          >
            {t(locale, 'content.discover.nextPage')}
            <ChevronRightIcon className="size-5" strokeWidth={1.5} aria-hidden />
          </button>
        </nav>
      ) : null}
    </div>
  );
}
