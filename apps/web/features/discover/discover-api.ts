import { keepPreviousData, useQuery } from '@tanstack/react-query';

import {
  type PublicCategoryListData,
  publicCategoryListDataSchema,
  type SourceRecordListData,
  sourceRecordListDataSchema,
  type SourceRecordListQuery,
} from '@gloaming/shared/discovery';
import {
  type SourceRecordSaveResult,
  sourceRecordSaveResultSchema,
  type SourceRecordSaveStatus,
  sourceRecordSaveStatusSchema,
} from '@gloaming/shared/library';
import { DEFAULT_PAGE, DEFAULT_SORT_ORDER } from '@gloaming/shared/pagination';
import {
  type CatalogListData,
  catalogListDataSchema,
  type CatalogListQuery,
  DEFAULT_CATALOG_SORT_BY,
} from '@gloaming/shared/works';

import { DISCOVER_PAGE_SIZE } from '@/features/discover/discover-model';
import { apiRequest, formatApiError } from '@/lib/api-request';
import { authClient } from '@/lib/auth';

/** Filters Discover owns; `language` stays the backend English-first default. */
export type DiscoverListParams = Partial<Pick<SourceRecordListQuery, 'page' | 'pageSize' | 'q' | 'categoryId'>>;

/** Compatibility Catalog read parameters; it never carries a SourceRecord category. */
export type DiscoverLegacyParams = Partial<Pick<CatalogListQuery, 'page' | 'pageSize' | 'q'>>;

export const discoverQueryKey = {
  all: ['discover'] as const,
  records: (params: DiscoverListParams) => [...discoverQueryKey.all, 'records', params] as const,
  categories: () => [...discoverQueryKey.all, 'categories'] as const,
  legacyWorks: (params: DiscoverLegacyParams) => [...discoverQueryKey.all, 'legacy-works', params] as const,
  saveStatus: (sourceRecordId: string) => [...discoverQueryKey.all, 'save-status', sourceRecordId] as const,
};

const DEFAULT_RECORD_SORT_BY = 'sourceUpdatedAt' as const;

/** Builds the query string for `GET /api/discover/records`. Exported for pure unit tests. */
export function buildDiscoverRecordsQuery(params: DiscoverListParams): string {
  const search = new URLSearchParams();
  search.set('page', String(params.page ?? DEFAULT_PAGE));
  search.set('pageSize', String(params.pageSize ?? DISCOVER_PAGE_SIZE));
  search.set('sortBy', DEFAULT_RECORD_SORT_BY);
  search.set('sortOrder', DEFAULT_SORT_ORDER);
  if (params.q) {
    search.set('q', params.q);
  }
  if (params.categoryId) {
    search.set('categoryId', params.categoryId);
  }
  return search.toString();
}

/**
 * Builds the compatibility `GET /api/catalog/works` query. The `sourceLink=unlinked`
 * filter keeps already-published ReadingWorks visible without duplicating a Work
 * already represented by a SourceRecord.
 */
export function buildDiscoverLegacyQuery(params: DiscoverLegacyParams): string {
  const search = new URLSearchParams();
  search.set('page', String(params.page ?? DEFAULT_PAGE));
  search.set('pageSize', String(params.pageSize ?? DISCOVER_PAGE_SIZE));
  search.set('sortBy', DEFAULT_CATALOG_SORT_BY);
  search.set('sortOrder', DEFAULT_SORT_ORDER);
  search.set('sourceLink', 'unlinked');
  if (params.q) {
    search.set('q', params.q);
  }
  return search.toString();
}

export async function fetchDiscoverRecords(
  params: DiscoverListParams,
  init?: { signal?: AbortSignal },
): Promise<SourceRecordListData> {
  const qs = buildDiscoverRecordsQuery(params);
  return apiRequest(`/api/discover/records?${qs}`, {
    schema: sourceRecordListDataSchema,
    signal: init?.signal,
  });
}

export async function fetchDiscoverCategories(init?: { signal?: AbortSignal }): Promise<PublicCategoryListData> {
  return apiRequest('/api/discover/categories', {
    schema: publicCategoryListDataSchema,
    signal: init?.signal,
  });
}

export async function fetchDiscoverLegacyWorks(
  params: DiscoverLegacyParams,
  init?: { signal?: AbortSignal },
): Promise<CatalogListData> {
  const qs = buildDiscoverLegacyQuery(params);
  return apiRequest(`/api/catalog/works?${qs}`, {
    schema: catalogListDataSchema,
    signal: init?.signal,
  });
}

/**
 * Explicit SourceRecord Save Intent. The user action creates the durable intent;
 * the backend returns `pending` (import queued) or `ready` (readable Work and
 * Library membership already exist). This never auto-saves or navigates.
 */
export async function saveSourceRecordToLibrary(sourceRecordId: string): Promise<SourceRecordSaveResult> {
  return apiRequest(`/api/library/source-records/${encodeURIComponent(sourceRecordId)}`, {
    method: 'POST',
    schema: sourceRecordSaveResultSchema,
  });
}

/** Owner-scoped Save Intent status; `status` is authoritative over linked ids. */
export async function fetchSourceRecordSaveStatus(
  sourceRecordId: string,
  init?: { signal?: AbortSignal },
): Promise<SourceRecordSaveStatus> {
  return apiRequest(`/api/library/source-records/${encodeURIComponent(sourceRecordId)}`, {
    schema: sourceRecordSaveStatusSchema,
    signal: init?.signal,
  });
}

/** Poll cadence while the server reports an in-flight import. */
export const SOURCE_RECORD_SAVE_POLL_MS = 2_000;

/**
 * Poll only while `pending`; `ready`, `failed`, and `none` settle immediately.
 * Exported as a pure function for unit tests.
 */
export function saveStatusRefetchInterval(query: { state: { data?: SourceRecordSaveStatus } }): number | false {
  return query.state.data?.status === 'pending' ? SOURCE_RECORD_SAVE_POLL_MS : false;
}

/**
 * Refresh recovery for the Save Intent: hydrates pending/failed/ready state on
 * mount (a linked `linkedWorkId` never short-circuits this — the Work may still
 * be parsing) and polls while the server reports `pending`. Enabled only for
 * authenticated viewers; anonymous visitors simply never query.
 */
export function useSourceRecordSaveStatusQuery(sourceRecordId: string, options?: { enabled?: boolean }) {
  const { data: authData } = authClient.useSession();
  const isAuthenticated = Boolean(authData?.user);
  return useQuery({
    queryKey: discoverQueryKey.saveStatus(sourceRecordId),
    queryFn: ({ signal }) => fetchSourceRecordSaveStatus(sourceRecordId, { signal }),
    refetchInterval: saveStatusRefetchInterval,
    enabled: (options?.enabled ?? true) && isAuthenticated,
  });
}

export function useDiscoverRecordsQuery(params: DiscoverListParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: discoverQueryKey.records(params),
    queryFn: ({ signal }) => fetchDiscoverRecords(params, { signal }),
    placeholderData: keepPreviousData,
    enabled: options?.enabled ?? true,
  });
}

export function useDiscoverCategoriesQuery() {
  return useQuery({
    queryKey: discoverQueryKey.categories(),
    queryFn: ({ signal }) => fetchDiscoverCategories({ signal }),
  });
}

export const formatDiscoverApiError = formatApiError;
