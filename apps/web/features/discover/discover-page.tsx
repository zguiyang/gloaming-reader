'use client';

import { useMemo, useState } from 'react';

import { t } from '@gloaming/i18n';

import { LoadingOverlay } from '@/components/loading-overlay';
import { Button } from '@/components/ui/button';
import {
  type DiscoverCatalogResult,
  discoverQueryKey,
  fetchDiscoverCatalog,
  formatDiscoverApiError,
} from '@/features/discover/discover-api';
import { DiscoverEmptyState } from '@/features/discover/discover-empty-state';
import { DiscoverGrid } from '@/features/discover/discover-grid';
import { DiscoverHeader } from '@/features/discover/discover-header';
import { DISCOVER_PAGE_SIZE, type DiscoverItem } from '@/features/discover/discover-model';
import { DiscoverPagination } from '@/features/discover/discover-pagination';
import { useLocale } from '@/lib/locale-context';
import { usePaginatedQuery } from '@/lib/query';
import { cn } from '@/lib/utils';

const LIST_REFRESH_MIN_MS = 300;

function DiscoverSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-8 md:grid-cols-4 md:gap-x-8 md:gap-y-12 lg:grid-cols-5" aria-hidden>
      {Array.from({ length: DISCOVER_PAGE_SIZE }, (_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <div className="aspect-[2/3] animate-pulse rounded-sm bg-surface-container-high" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-surface-container-high" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-surface-container-high" />
        </div>
      ))}
    </div>
  );
}

export function DiscoverPage() {
  const { locale } = useLocale();
  const [page, setPage] = useState(1);
  const [mobileVisible, setMobileVisible] = useState(DISCOVER_PAGE_SIZE);

  const listParams = useMemo(
    () => ({
      page,
      pageSize: DISCOVER_PAGE_SIZE,
    }),
    [page],
  );

  const list = usePaginatedQuery<DiscoverItem, DiscoverCatalogResult>({
    queryKey: discoverQueryKey.list(listParams),
    queryFn: ({ signal }) => fetchDiscoverCatalog(listParams, { signal }),
    page,
    onPageChange: (next) => {
      setPage(next);
      setMobileVisible(DISCOVER_PAGE_SIZE);
    },
    softRefreshMinMs: LIST_REFRESH_MIN_MS,
  });

  const items = list.items;
  const totalPages = list.totalPages;
  const safePage = list.page;
  const mobileItems = items.slice(0, mobileVisible);
  const hasMoreMobile = mobileVisible < items.length;
  const isCatalogEmpty = !list.isInitialLoading && items.length === 0;

  function handlePageChange(next: number) {
    setPage(next);
    setMobileVisible(DISCOVER_PAGE_SIZE);
  }

  return (
    <div
      className={cn(
        'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700',
        'flex w-full flex-col',
        isCatalogEmpty ? 'min-h-[70dvh] justify-center' : '',
      )}
    >
      <DiscoverHeader />

      {list.isInitialLoading ? (
        <DiscoverSkeleton />
      ) : list.isError && !list.data ? (
        <div className="flex flex-col items-center py-16 text-center">
          <h2 className="font-heading text-2xl font-semibold">{t(locale, 'content.discover.loadFailed')}</h2>
          <p className="mt-4 text-muted-foreground">{formatDiscoverApiError(list.error)}</p>
          <Button className="mt-8 rounded-full px-10" onClick={() => void list.query.refetch()}>
            {t(locale, 'content.common.retry')}
          </Button>
        </div>
      ) : (
        <LoadingOverlay active={list.isSoftRefreshing} label={t(locale, 'content.discover.softRefreshing')}>
          {isCatalogEmpty ? (
            <DiscoverEmptyState />
          ) : items.length === 0 ? (
            <DiscoverEmptyState />
          ) : (
            <>
              <div className="md:hidden">
                <DiscoverGrid items={mobileItems} />
              </div>
              <div className="hidden md:block">
                <DiscoverGrid items={items} />
              </div>
              <DiscoverPagination
                page={safePage}
                totalPages={totalPages}
                onPageChange={handlePageChange}
                hasMoreMobile={hasMoreMobile}
                onLoadMore={() => setMobileVisible((n) => n + DISCOVER_PAGE_SIZE)}
              />
            </>
          )}
        </LoadingOverlay>
      )}
    </div>
  );
}
