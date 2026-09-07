import { keepPreviousData, useQuery } from '@tanstack/react-query';

import type { ShelfItem } from '@gloaming/shared';
import {
  type CatalogListData,
  catalogListDataSchema,
  type CatalogListQuery,
  type CatalogWork,
  DEFAULT_CATALOG_SORT_BY,
} from '@gloaming/shared';
import { DEFAULT_PAGE, DEFAULT_SORT_ORDER } from '@gloaming/shared/pagination';

import {
  DISCOVER_PAGE_SIZE,
  type DiscoverItem,
  type DiscoverShelfStatus,
  type DiscoverTagFilter,
} from '@/features/discover/discover-model';
import { buildShelfItemMap, coverUrlFromAssetId, getShelf } from '@/features/works-http';
import { apiRequest, ApiRequestError, formatApiError } from '@/lib/api-request';

export type DiscoverListParams = Partial<Pick<CatalogListQuery, 'page' | 'pageSize' | 'tag' | 'q'>>;

export type DiscoverCatalogResult = {
  items: DiscoverItem[];
  tags: string[];
  pagination: CatalogListData['pagination'];
};

export const discoverQueryKey = {
  all: ['discover'] as const,
  list: (params: DiscoverListParams) => [...discoverQueryKey.all, 'list', params] as const,
};

function toIsoString(value: string | Date | null | undefined): string {
  if (!value) {
    return '';
  }
  return typeof value === 'string' ? value : value.toISOString();
}

function buildListQuery(params: DiscoverListParams): string {
  const search = new URLSearchParams();
  search.set('page', String(params.page ?? DEFAULT_PAGE));
  search.set('pageSize', String(params.pageSize ?? DISCOVER_PAGE_SIZE));
  search.set('sortBy', DEFAULT_CATALOG_SORT_BY);
  search.set('sortOrder', DEFAULT_SORT_ORDER);
  if (params.tag) {
    search.set('tag', params.tag);
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
  const qs = buildListQuery(params);
  return apiRequest(`/api/catalog/works?${qs}`, {
    schema: catalogListDataSchema,
    signal: init?.signal,
  });
}

export function resolveShelfStatus(item?: ShelfItem): DiscoverShelfStatus {
  if (!item) {
    return 'available';
  }
  if (item.state.status === 'in_progress' && item.state.progressRatio > 0) {
    return 'in_progress';
  }
  return 'on_shelf';
}

export function toDiscoverItem(work: CatalogWork, shelfItem?: ShelfItem): DiscoverItem {
  const shelfStatus = resolveShelfStatus(shelfItem);
  return {
    id: work.id,
    title: work.title,
    author: work.author.trim(),
    partCount: work.partCount,
    tags: work.tags,
    coverImageUrl: coverUrlFromAssetId(work.coverAssetId),
    publishedAt: toIsoString(work.publishedAt) || toIsoString(work.createdAt),
    shelfStatus,
    progressRatio: shelfItem?.state.progressRatio ?? null,
  };
}

export async function fetchDiscoverCatalog(
  params: DiscoverListParams,
  init?: { signal?: AbortSignal },
): Promise<DiscoverCatalogResult> {
  const [listData, shelfData] = await Promise.all([
    listCatalogWorks(params, init),
    getShelf(init).catch((error: unknown) => {
      if (error instanceof ApiRequestError && error.status === 401) {
        return null;
      }
      throw error;
    }),
  ]);
  const shelfMap = shelfData ? buildShelfItemMap(shelfData) : new Map<string, ShelfItem>();
  return {
    items: listData.items.map((work) => toDiscoverItem(work, shelfMap.get(work.id))),
    tags: listData.tags,
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

export function tagFilterParam(tag: DiscoverTagFilter): string | undefined {
  return tag === '全部' ? undefined : tag;
}

export const formatDiscoverApiError = formatApiError;
