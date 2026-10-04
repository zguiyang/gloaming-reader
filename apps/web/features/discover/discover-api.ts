import { keepPreviousData, useQuery } from '@tanstack/react-query';

import type { ContinueReadingItem, LibraryItem } from '@gloaming/shared/library';
import { DEFAULT_PAGE, DEFAULT_SORT_ORDER } from '@gloaming/shared/pagination';
import {
  type CatalogListData,
  catalogListDataSchema,
  type CatalogListQuery,
  type CatalogWork,
  DEFAULT_CATALOG_SORT_BY,
} from '@gloaming/shared/works';

import { DISCOVER_PAGE_SIZE, type DiscoverItem, type DiscoverLibraryStatus } from '@/features/discover/discover-model';
import { getLibrary } from '@/features/library/library-public';
import { apiRequest, formatApiError } from '@/lib/api-request';
import { coverUrlFromAssetId } from '@/lib/asset-url';

export type DiscoverListParams = Partial<Pick<CatalogListQuery, 'page' | 'pageSize' | 'q' | 'sortBy' | 'sortOrder'>>;

export type DiscoverCatalogResult = {
  items: DiscoverItem[];
  pagination: CatalogListData['pagination'];
};

export const discoverQueryKey = {
  all: ['discover'] as const,
  list: (params: DiscoverListParams) => [...discoverQueryKey.all, 'list', params] as const,
  libraryState: () => [...discoverQueryKey.all, 'library-state'] as const,
};

function toIsoString(value: string | Date | null | undefined): string {
  if (!value) {
    return '';
  }
  return typeof value === 'string' ? value : value.toISOString();
}

/** Builds the query string for `GET /api/catalog/works`. Exported for pure unit tests. */
export function buildDiscoverListQuery(params: DiscoverListParams): string {
  const search = new URLSearchParams();
  search.set('page', String(params.page ?? DEFAULT_PAGE));
  search.set('pageSize', String(params.pageSize ?? DISCOVER_PAGE_SIZE));
  search.set('sortBy', params.sortBy ?? DEFAULT_CATALOG_SORT_BY);
  search.set('sortOrder', params.sortOrder ?? DEFAULT_SORT_ORDER);
  if (params.q) {
    search.set('q', params.q);
  }
  return search.toString();
}

export async function listCatalogWorks(
  params: DiscoverListParams = {},
  init?: { signal?: AbortSignal },
): Promise<CatalogListData> {
  const qs = buildDiscoverListQuery(params);
  return apiRequest(`/api/catalog/works?${qs}`, {
    schema: catalogListDataSchema,
    signal: init?.signal,
  });
}

export function resolveLibraryStatus(item?: LibraryItem): DiscoverLibraryStatus {
  return item ? 'in_library' : 'available';
}

export function toDiscoverItem(
  work: CatalogWork,
  libraryItem?: LibraryItem,
  current?: ContinueReadingItem | null,
): DiscoverItem {
  const libraryStatus = resolveLibraryStatus(libraryItem);
  const state = libraryItem?.state ?? (current?.work.id === work.id ? current.state : null);
  return {
    id: work.id,
    title: work.title,
    author: work.author.trim(),
    partCount: work.partCount,
    coverImageUrl: coverUrlFromAssetId(work.coverAssetId),
    publishedAt: toIsoString(work.publishedAt) || toIsoString(work.createdAt),
    libraryStatus,
    progressRatio: state?.status === 'in_progress' ? state.progressRatio : null,
  };
}

export async function fetchDiscoverCatalog(
  params: DiscoverListParams,
  init?: { signal?: AbortSignal },
): Promise<DiscoverCatalogResult> {
  const listData = await listCatalogWorks(params, init);
  return {
    items: listData.items.map((work) => toDiscoverItem(work)),
    pagination: listData.pagination,
  };
}

/** Saved state is optional on Discover and settles independently from public Catalog content. */
export function useDiscoverLibraryStateQuery() {
  return useQuery({
    queryKey: discoverQueryKey.libraryState(),
    queryFn: ({ signal }) => getLibrary({ signal }),
  });
}

export function useDiscoverCatalogQuery(params: DiscoverListParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: discoverQueryKey.list(params),
    queryFn: ({ signal }) => fetchDiscoverCatalog(params, { signal }),
    placeholderData: keepPreviousData,
    enabled: options?.enabled ?? true,
  });
}

export const formatDiscoverApiError = formatApiError;
