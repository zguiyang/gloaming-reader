import { keepPreviousData, useQuery } from '@tanstack/react-query';

import type { ContinueReadingItem, LibraryItem } from '@gloaming/shared/library';
import { DEFAULT_PAGE, DEFAULT_SORT_ORDER } from '@gloaming/shared/pagination';
import { type CatalogTaxonomyListData, catalogTaxonomyListDataSchema } from '@gloaming/shared/taxonomy';
import {
  type CatalogListData,
  catalogListDataSchema,
  type CatalogListQuery,
  type CatalogWork,
  DEFAULT_CATALOG_SORT_BY,
} from '@gloaming/shared/works';

import { DISCOVER_PAGE_SIZE, type DiscoverItem, type DiscoverLibraryStatus } from '@/features/discover/discover-model';
import { buildLibraryItemMap, getLibrary } from '@/features/library/library-public';
import { apiRequest, ApiRequestError, formatApiError } from '@/lib/api-request';
import { coverUrlFromAssetId } from '@/lib/asset-url';

export type DiscoverListParams = Partial<
  Pick<CatalogListQuery, 'page' | 'pageSize' | 'category' | 'tag' | 'q' | 'sortBy' | 'sortOrder'>
>;

export type DiscoverCatalogResult = {
  items: DiscoverItem[];
  pagination: CatalogListData['pagination'];
};

export const discoverQueryKey = {
  all: ['discover'] as const,
  list: (params: DiscoverListParams) => [...discoverQueryKey.all, 'list', params] as const,
  tags: () => [...discoverQueryKey.all, 'tags'] as const,
  categories: () => [...discoverQueryKey.all, 'categories'] as const,
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
  if (params.category) {
    search.set('category', params.category);
  }
  if (params.tag?.length) {
    search.set('tag', params.tag.join(','));
  }
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

export async function fetchDiscoverTags(init?: { signal?: AbortSignal }): Promise<CatalogTaxonomyListData> {
  return apiRequest('/api/catalog/tags', {
    schema: catalogTaxonomyListDataSchema,
    signal: init?.signal,
  });
}

export async function fetchDiscoverCategories(init?: { signal?: AbortSignal }): Promise<CatalogTaxonomyListData> {
  return apiRequest('/api/catalog/categories', {
    schema: catalogTaxonomyListDataSchema,
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
    tags: work.tags,
    category: work.category,
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
  const [listData, libraryData] = await Promise.all([
    listCatalogWorks(params, init),
    getLibrary(init).catch((error: unknown) => {
      if (error instanceof ApiRequestError && error.status === 401) {
        return null;
      }
      throw error;
    }),
  ]);
  const libraryMap = libraryData ? buildLibraryItemMap(libraryData) : new Map<string, LibraryItem>();
  return {
    items: listData.items.map((work) => toDiscoverItem(work, libraryMap.get(work.id), libraryData?.current)),
    pagination: listData.pagination,
  };
}

export function useDiscoverCatalogQuery(params: DiscoverListParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: discoverQueryKey.list(params),
    queryFn: ({ signal }) => fetchDiscoverCatalog(params, { signal }),
    placeholderData: keepPreviousData,
    enabled: options?.enabled ?? true,
  });
}

export function useDiscoverTagsQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: discoverQueryKey.tags(),
    queryFn: ({ signal }) => fetchDiscoverTags({ signal }),
    enabled: options?.enabled ?? true,
  });
}

export function useDiscoverCategoriesQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: discoverQueryKey.categories(),
    queryFn: ({ signal }) => fetchDiscoverCategories({ signal }),
    enabled: options?.enabled ?? true,
  });
}

export const formatDiscoverApiError = formatApiError;
