'use client';

import { useMemo, useState } from 'react';

import { t } from '@/i18n';
import type { DiscoveryFacet, SourceRecordItem, SourceRecordListData } from '@/shared/discovery';
import type { CatalogListData, CatalogWork } from '@/shared/works';

import { LoadingOverlay } from '@/components/loading-overlay';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DiscoverActiveFilters } from '@/features/discover/discover-active-filters';
import {
  discoverQueryKey,
  fetchDiscoverLegacyWorks,
  fetchDiscoverRecords,
  formatDiscoverApiError,
  useDiscoverFacetsQuery,
  useDiscoverSourcesQuery,
} from '@/features/discover/discover-api';
import { DiscoverEmptyState } from '@/features/discover/discover-empty-state';
import { DiscoverFacets } from '@/features/discover/discover-facets';
import { DiscoverGrid } from '@/features/discover/discover-grid';
import { DiscoverHeader } from '@/features/discover/discover-header';
import { DiscoverLegacyGrid } from '@/features/discover/discover-legacy-grid';
import {
  DISCOVER_PAGE_SIZE,
  type DiscoverLegacyWork,
  hasActiveDiscoverFilter,
  toDiscoverItem,
  toDiscoverLegacyWork,
} from '@/features/discover/discover-model';
import { DiscoverPagination } from '@/features/discover/discover-pagination';
import { DiscoverSearch } from '@/features/discover/discover-search';
import { DiscoverSources } from '@/features/discover/discover-sources';
import { coverUrlFromAssetId } from '@/lib/asset-url';
import { authClient } from '@/lib/auth';
import { useLocale } from '@/lib/locale-context';
import { usePaginatedQuery } from '@/lib/query';
import { cn } from '@/lib/utils';

const LIST_REFRESH_MIN_MS = 300;

function DiscoverSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-8 md:grid-cols-4 md:gap-x-8 md:gap-y-12 lg:grid-cols-5" aria-hidden>
      {Array.from({ length: DISCOVER_PAGE_SIZE }, (_, index) => (
        <div key={index} className="flex flex-col gap-3">
          <Skeleton className="aspect-[2/3] rounded-sm bg-surface-container-high" />
          <Skeleton className="h-4 w-3/4 rounded bg-surface-container-high" />
          <Skeleton className="h-3 w-1/2 rounded bg-surface-container-high" />
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
  const { data } = authClient.useSession();
  const userId = data?.user.id ?? null;
  return <DiscoverPageContent key={userId ?? 'anonymous'} userId={userId} />;
}

function DiscoverPageContent({ userId }: { userId: string | null }) {
  const { locale } = useLocale();
  const [searchDraft, setSearchDraft] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [selectedSourceKey, setSelectedSourceKey] = useState<string | null>(null);
  const [facetBySource, setFacetBySource] = useState<Record<string, string | null>>({});
  const [page, setPage] = useState(1);
  const [legacyPage, setLegacyPage] = useState(1);

  const sourcesQuery = useDiscoverSourcesQuery();
  const sources = useMemo(() => sourcesQuery.data?.items ?? [], [sourcesQuery.data?.items]);
  const sourceKey = useMemo(() => {
    if (sources.length === 0) return null;
    if (selectedSourceKey && sources.some((source) => source.sourceKey === selectedSourceKey)) {
      return selectedSourceKey;
    }
    return sources[0]?.sourceKey ?? null;
  }, [sources, selectedSourceKey]);
  const facetId = sourceKey ? (facetBySource[sourceKey] ?? null) : null;

  const facetsQuery = useDiscoverFacetsQuery(sourceKey);
  const facets: DiscoveryFacet[] = facetsQuery.data?.items ?? [];

  function resetListView() {
    setPage(1);
    setLegacyPage(1);
  }

  function handlePageChange(next: number) {
    setPage(next);
  }

  function handleLegacyPageChange(next: number) {
    setLegacyPage(next);
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

  function handleSelectSource(next: string) {
    setSelectedSourceKey(next);
    resetListView();
  }

  function handleSelectFacet(next: string | null) {
    if (!sourceKey) return;
    setFacetBySource((current) => ({ ...current, [sourceKey]: next }));
    resetListView();
  }

  function handleClearFilters() {
    setSearchDraft('');
    setAppliedQuery('');
    if (sourceKey) {
      setFacetBySource((current) => ({ ...current, [sourceKey]: null }));
    }
    resetListView();
  }

  const recordsParams = useMemo(
    () => ({
      page,
      pageSize: DISCOVER_PAGE_SIZE,
      q: appliedQuery || undefined,
      sourceKey: sourceKey ?? undefined,
      facetId: facetId ?? undefined,
    }),
    [page, appliedQuery, sourceKey, facetId],
  );

  const legacyParams = useMemo(
    () => ({ page: legacyPage, pageSize: DISCOVER_PAGE_SIZE, q: appliedQuery || undefined }),
    [legacyPage, appliedQuery],
  );

  const recordsList = usePaginatedQuery<SourceRecordItem, SourceRecordListData>({
    queryKey: discoverQueryKey.records(recordsParams, userId),
    queryFn: ({ signal }) => fetchDiscoverRecords(recordsParams, { signal }),
    page,
    onPageChange: handlePageChange,
    softRefreshMinMs: LIST_REFRESH_MIN_MS,
    enabled: Boolean(sourceKey),
  });

  const isLegacyEnabled = facetId === null && Boolean(sourceKey);

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

  const selectedFacetLabel = facetId ? (facets.find((facet) => facet.id === facetId)?.name ?? facetId) : null;

  const isFiltered = hasActiveDiscoverFilter(appliedQuery, facetId);
  const noSources = sourcesQuery.isSuccess && sources.length === 0 && !sourcesQuery.isFetching;
  const isRecordsUnavailable = Boolean(sourceKey) && recordsList.isError && !recordsList.data;
  const isRecordsSettled = recordsList.query.isSuccess && !recordsList.query.isPlaceholderData;
  const isRecordsEmpty = Boolean(sourceKey) && isRecordsSettled && recordsList.items.length === 0;

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
        <DiscoverSources
          sources={sources}
          selectedSourceKey={sourceKey}
          onSelect={handleSelectSource}
          isLoading={sourcesQuery.isLoading}
          isError={sourcesQuery.isError && !sourcesQuery.data}
          onRetry={() => void sourcesQuery.refetch()}
        />
        {sourceKey ? (
          <DiscoverFacets
            facets={facets}
            selectedFacetId={facetId}
            onSelect={handleSelectFacet}
            isLoading={facetsQuery.isLoading}
            isError={facetsQuery.isError && !facetsQuery.data}
            onRetry={() => void facetsQuery.refetch()}
          />
        ) : null}
        <DiscoverActiveFilters
          query={appliedQuery}
          facetLabel={selectedFacetLabel}
          onClearQuery={handleClearSearch}
          onClearFacet={() => handleSelectFacet(null)}
        />
      </div>

      {sourcesQuery.isLoading ? (
        <DiscoverSkeleton />
      ) : noSources ? (
        <div className="flex flex-col items-center py-16 text-center">
          <h2 className="font-heading text-2xl font-semibold">{t(locale, 'content.discover.noSourcesTitle')}</h2>
          <p className="mt-4 max-w-md text-muted-foreground">{t(locale, 'content.discover.noSourcesDescription')}</p>
        </div>
      ) : !sourceKey ? (
        <DiscoverSkeleton />
      ) : recordsList.isInitialLoading ? (
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
                <DiscoverGrid items={recordsItems} userId={userId} />
              </div>
              <div className="hidden md:block">
                <DiscoverGrid items={recordsItems} userId={userId} />
              </div>
              <DiscoverPagination
                page={recordsList.page}
                hasMore={recordsList.data?.hasMore ?? recordsList.page < recordsList.totalPages}
                onPageChange={handlePageChange}
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
                      <DiscoverLegacyGrid items={legacyItems} />
                    </div>
                    <div className="hidden md:block">
                      <DiscoverLegacyGrid items={legacyItems} />
                    </div>
                  </section>
                  <DiscoverPagination
                    page={legacyList.page}
                    hasMore={legacyList.page < legacyList.totalPages}
                    onPageChange={handleLegacyPageChange}
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
