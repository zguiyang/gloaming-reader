'use client';

import { useMemo, useState } from 'react';

import { t } from '@gloaming/i18n';
import type { PublicCategoryListItem, SourceRecordItem, SourceRecordListData } from '@gloaming/shared/discovery';
import type { CatalogListData, CatalogWork } from '@gloaming/shared/works';

import { LoadingOverlay } from '@/components/loading-overlay';
import { Button } from '@/components/ui/button';
import { DiscoverActiveFilters } from '@/features/discover/discover-active-filters';
import {
  discoverQueryKey,
  fetchDiscoverLegacyWorks,
  fetchDiscoverRecords,
  formatDiscoverApiError,
  useDiscoverCategoriesQuery,
} from '@/features/discover/discover-api';
import { DiscoverCategories } from '@/features/discover/discover-categories';
import { DiscoverEmptyState } from '@/features/discover/discover-empty-state';
import { DiscoverGrid } from '@/features/discover/discover-grid';
import { DiscoverHeader } from '@/features/discover/discover-header';
import { DiscoverLegacyGrid } from '@/features/discover/discover-legacy-grid';
import {
  categoryDisplayName,
  DISCOVER_PAGE_SIZE,
  type DiscoverLegacyWork,
  hasActiveDiscoverFilter,
  toDiscoverItem,
  toDiscoverLegacyWork,
} from '@/features/discover/discover-model';
import { DiscoverPagination } from '@/features/discover/discover-pagination';
import { DiscoverSearch } from '@/features/discover/discover-search';
import { coverUrlFromAssetId } from '@/lib/asset-url';
import { useLocale } from '@/lib/locale-context';
import { usePaginatedQuery } from '@/lib/query';
import { cn } from '@/lib/utils';

const LIST_REFRESH_MIN_MS = 300;

function DiscoverSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-8 md:grid-cols-4 md:gap-x-8 md:gap-y-12 lg:grid-cols-5" aria-hidden>
      {Array.from({ length: DISCOVER_PAGE_SIZE }, (_, index) => (
        <div key={index} className="flex flex-col gap-3">
          <div className="aspect-[2/3] animate-pulse rounded-sm bg-surface-container-high" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-surface-container-high" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-surface-container-high" />
        </div>
      ))}
    </div>
  );
}

function DiscoverErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { locale } = useLocale();

  return (
    <div className="flex flex-col items-center py-16 text-center">
      <h2 className="font-heading text-2xl font-semibold">{t(locale, 'content.discover.loadFailed')}</h2>
      <p className="mt-4 text-muted-foreground">{message}</p>
      <Button className="mt-8 rounded-full px-10" onClick={onRetry}>
        {t(locale, 'content.common.retry')}
      </Button>
    </div>
  );
}

export function DiscoverPage() {
  const { locale } = useLocale();
  const [searchDraft, setSearchDraft] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [mobileVisible, setMobileVisible] = useState(DISCOVER_PAGE_SIZE);
  const [legacyPage, setLegacyPage] = useState(1);
  const [legacyMobileVisible, setLegacyMobileVisible] = useState(DISCOVER_PAGE_SIZE);

  const categoriesQuery = useDiscoverCategoriesQuery();
  const categories: PublicCategoryListItem[] = categoriesQuery.data?.items ?? [];

  function resetListView() {
    setPage(1);
    setMobileVisible(DISCOVER_PAGE_SIZE);
    setLegacyPage(1);
    setLegacyMobileVisible(DISCOVER_PAGE_SIZE);
  }

  function handlePageChange(next: number) {
    setPage(next);
    setMobileVisible(DISCOVER_PAGE_SIZE);
  }

  function handleLegacyPageChange(next: number) {
    setLegacyPage(next);
    setLegacyMobileVisible(DISCOVER_PAGE_SIZE);
  }

  function handleSearchSubmit() {
    setAppliedQuery(searchDraft.trim());
    resetListView();
  }

  function handleClearSearch() {
    setSearchDraft('');
    setAppliedQuery('');
    resetListView();
  }

  function handleSelectCategory(next: string | null) {
    setCategoryId(next);
    resetListView();
  }

  function handleClearFilters() {
    setSearchDraft('');
    setAppliedQuery('');
    setCategoryId(null);
    resetListView();
  }

  const recordsParams = useMemo(
    () => ({
      page,
      pageSize: DISCOVER_PAGE_SIZE,
      q: appliedQuery || undefined,
      categoryId: categoryId ?? undefined,
    }),
    [page, appliedQuery, categoryId],
  );

  const legacyParams = useMemo(
    () => ({ page: legacyPage, pageSize: DISCOVER_PAGE_SIZE, q: appliedQuery || undefined }),
    [legacyPage, appliedQuery],
  );

  const recordsList = usePaginatedQuery<SourceRecordItem, SourceRecordListData>({
    queryKey: discoverQueryKey.records(recordsParams),
    queryFn: ({ signal }) => fetchDiscoverRecords(recordsParams, { signal }),
    page,
    onPageChange: handlePageChange,
    softRefreshMinMs: LIST_REFRESH_MIN_MS,
  });

  // Compatibility path: already-published Catalog Works without a SourceRecord.
  // Category filtering is SourceRecord-only, so legacy works are omitted while a
  // category is selected; otherwise they render alongside the SourceRecord list.
  const isLegacyEnabled = categoryId === null;

  const legacyList = usePaginatedQuery<CatalogWork, CatalogListData>({
    queryKey: discoverQueryKey.legacyWorks(legacyParams),
    queryFn: ({ signal }) => fetchDiscoverLegacyWorks(legacyParams, { signal }),
    page: legacyPage,
    onPageChange: handleLegacyPageChange,
    enabled: isLegacyEnabled,
  });

  const recordsItems = useMemo(() => recordsList.items.map((record) => toDiscoverItem(record)), [recordsList.items]);
  const legacyItems: DiscoverLegacyWork[] = legacyList.items.map((work) =>
    toDiscoverLegacyWork(work, coverUrlFromAssetId(work.coverAssetId)),
  );

  const mobileItems = recordsItems.slice(0, mobileVisible);
  const hasMoreMobile = mobileVisible < recordsItems.length;
  const legacyMobileItems = legacyItems.slice(0, legacyMobileVisible);
  const hasMoreLegacyMobile = legacyMobileVisible < legacyItems.length;

  const selectedCategoryLabel = categoryId
    ? (() => {
        const match = categories.find((category) => category.id === categoryId);
        return match ? categoryDisplayName(match) : categoryId;
      })()
    : null;

  const isFiltered = hasActiveDiscoverFilter({ query: appliedQuery, categoryId });
  const isRecordsUnavailable = recordsList.isError && !recordsList.data;
  const isRecordsSettled = recordsList.query.isSuccess && !recordsList.query.isPlaceholderData;
  const isRecordsEmpty = isRecordsSettled && recordsList.items.length === 0;

  const isLegacyFailed = legacyList.isError && !legacyList.data;
  const isLegacySettled = legacyList.query.isSuccess && !legacyList.query.isPlaceholderData;
  const isLegacyEmpty = isLegacySettled && legacyItems.length === 0;
  const shouldShowLegacySection =
    isLegacyEnabled && (legacyList.isInitialLoading || isLegacyFailed || legacyItems.length > 0);
  const shouldShowEmptyState =
    isRecordsEmpty && (!isLegacyEnabled || (!legacyList.isInitialLoading && !isLegacyFailed && isLegacyEmpty));

  return (
    <div
      className={cn(
        'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700',
        'flex w-full flex-col',
      )}
    >
      <DiscoverHeader />

      <div className="mb-8 flex flex-col gap-4 md:mb-12">
        <DiscoverSearch
          value={searchDraft}
          onValueChange={setSearchDraft}
          onSubmit={handleSearchSubmit}
          onClear={handleClearSearch}
        />
        <DiscoverCategories
          categories={categories}
          selectedCategoryId={categoryId}
          onSelect={handleSelectCategory}
          isLoading={categoriesQuery.isLoading}
          isError={categoriesQuery.isError && !categoriesQuery.data}
          onRetry={() => void categoriesQuery.refetch()}
        />
        <DiscoverActiveFilters
          query={appliedQuery}
          categoryLabel={selectedCategoryLabel}
          onClearQuery={handleClearSearch}
          onClearCategory={() => handleSelectCategory(null)}
        />
      </div>

      {recordsList.isInitialLoading ? (
        <DiscoverSkeleton />
      ) : isRecordsUnavailable ? (
        <DiscoverErrorState
          message={formatDiscoverApiError(recordsList.error)}
          onRetry={() => void recordsList.query.refetch()}
        />
      ) : (
        <div className="flex flex-col">
          {recordsItems.length > 0 ? (
            <LoadingOverlay active={recordsList.isSoftRefreshing} label={t(locale, 'content.discover.softRefreshing')}>
              <div className="md:hidden">
                <DiscoverGrid items={mobileItems} />
              </div>
              <div className="hidden md:block">
                <DiscoverGrid items={recordsItems} />
              </div>
              <DiscoverPagination
                page={recordsList.page}
                totalPages={recordsList.totalPages}
                onPageChange={handlePageChange}
                hasMoreMobile={hasMoreMobile}
                onLoadMore={() => setMobileVisible((value) => value + DISCOVER_PAGE_SIZE)}
              />
            </LoadingOverlay>
          ) : null}

          {shouldShowLegacySection ? (
            <div className={cn(recordsItems.length > 0 ? 'mt-14 md:mt-20' : '')}>
              {legacyList.isInitialLoading ? (
                <DiscoverSkeleton />
              ) : isLegacyFailed ? (
                <DiscoverErrorState
                  message={formatDiscoverApiError(legacyList.error)}
                  onRetry={() => void legacyList.query.refetch()}
                />
              ) : (
                <LoadingOverlay
                  active={legacyList.isSoftRefreshing}
                  label={t(locale, 'content.discover.softRefreshing')}
                >
                  <section
                    aria-label={t(locale, 'content.discover.legacySectionLabel')}
                    className="flex flex-col gap-5"
                  >
                    <div>
                      <h2 className="font-heading text-lg font-semibold text-foreground md:text-xl">
                        {t(locale, 'content.discover.legacySectionLabel')}
                      </h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t(locale, 'content.discover.legacySectionDescription')}
                      </p>
                    </div>
                    <div className="md:hidden">
                      <DiscoverLegacyGrid items={legacyMobileItems} />
                    </div>
                    <div className="hidden md:block">
                      <DiscoverLegacyGrid items={legacyItems} />
                    </div>
                  </section>
                  <DiscoverPagination
                    page={legacyList.page}
                    totalPages={legacyList.totalPages}
                    onPageChange={handleLegacyPageChange}
                    hasMoreMobile={hasMoreLegacyMobile}
                    onLoadMore={() => setLegacyMobileVisible((value) => value + DISCOVER_PAGE_SIZE)}
                  />
                </LoadingOverlay>
              )}
            </div>
          ) : null}

          {shouldShowEmptyState ? (
            <DiscoverEmptyState isFiltered={isFiltered} onClearFilters={handleClearFilters} />
          ) : null}
        </div>
      )}
    </div>
  );
}
