import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import {
  type DiscoveryFacetListData,
  discoveryFacetListDataSchema,
  type DiscoverySourceListData,
  discoverySourceListDataSchema,
  type SourceRecordListData,
  sourceRecordListDataSchema,
  type SourceRecordListQuery,
} from '@/shared/discovery';
import {
  type SourceRecordSaveResult,
  sourceRecordSaveResultSchema,
  type SourceRecordSaveStatus,
  sourceRecordSaveStatusSchema,
} from '@/shared/library';
import { DEFAULT_PAGE, DEFAULT_SORT_ORDER } from '@/shared/pagination';
import {
  type CatalogListData,
  catalogListDataSchema,
  type CatalogListQuery,
  DEFAULT_CATALOG_SORT_BY,
} from '@/shared/works';

import { DISCOVER_PAGE_SIZE } from '@/features/discover/discover-model';
import { apiRequest, formatApiError } from '@/lib/api-request';
import { authClient } from '@/lib/auth';

/** Filters Discover owns; `language` stays the backend English-first default. */
export type DiscoverListParams = Partial<
  Pick<SourceRecordListQuery, 'page' | 'pageSize' | 'q' | 'facetId' | 'sourceKey'>
>;

/** Compatibility Catalog read parameters. */
export type DiscoverLegacyParams = Partial<Pick<CatalogListQuery, 'page' | 'pageSize' | 'q'>>;

export const discoverQueryKey = {
  all: ['discover'] as const,
  records: (params: DiscoverListParams, userId: string | null) =>
    [...discoverQueryKey.all, 'records', userId, params] as const,
  sources: () => [...discoverQueryKey.all, 'sources'] as const,
  facets: (sourceKey?: string | null) => [...discoverQueryKey.all, 'facets', sourceKey ?? null] as const,
  legacyWorks: (params: DiscoverLegacyParams) => [...discoverQueryKey.all, 'legacy-works', params] as const,
  saveStatus: (sourceRecordId: string, userId: string | null) =>
    [...discoverQueryKey.all, 'save-status', userId, sourceRecordId] as const,
};

const DEFAULT_RECORD_SORT_BY = 'sourceUpdatedAt' as const;

const discoverSaveResultSchema = sourceRecordSaveResultSchema.extend({
  sourceRecordId: z.string().optional(),
});

export function buildDiscoverRecordsQuery(params: DiscoverListParams): string {
  const search = new URLSearchParams();
  search.set('page', String(params.page ?? DEFAULT_PAGE));
  search.set('pageSize', String(params.pageSize ?? DISCOVER_PAGE_SIZE));
  search.set('sortBy', DEFAULT_RECORD_SORT_BY);
  search.set('sortOrder', DEFAULT_SORT_ORDER);
  if (params.q) {
    search.set('q', params.q);
  }
  if (params.sourceKey) {
    search.set('sourceKey', params.sourceKey);
  }
  if (params.facetId) {
    search.set('facetId', params.facetId);
  }
  return search.toString();
}

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

export async function fetchDiscoverSources(init?: { signal?: AbortSignal }): Promise<DiscoverySourceListData> {
  return apiRequest('/api/discover/sources', {
    schema: discoverySourceListDataSchema,
    signal: init?.signal,
  });
}

export async function fetchDiscoverFacets(
  sourceKey?: string,
  init?: { signal?: AbortSignal },
): Promise<DiscoveryFacetListData> {
  const qs = sourceKey ? `?sourceKey=${encodeURIComponent(sourceKey)}` : '';
  return apiRequest(`/api/discover/facets${qs}`, {
    schema: discoveryFacetListDataSchema,
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

/** Save a remote Discover candidate (upsert SourceRecord + Save Intent). */
export async function saveDiscoverCandidateToLibrary(input: {
  sourceKey: string;
  externalId: string;
}): Promise<SourceRecordSaveResult & { sourceRecordId?: string }> {
  return apiRequest('/api/library/discover', {
    method: 'POST',
    json: input,
    schema: discoverSaveResultSchema,
  });
}

/** Save when a persisted SourceRecord id is already known. */
export async function saveSourceRecordToLibrary(sourceRecordId: string): Promise<SourceRecordSaveResult> {
  return apiRequest(`/api/library/source-records/${encodeURIComponent(sourceRecordId)}`, {
    method: 'POST',
    schema: sourceRecordSaveResultSchema,
  });
}

export async function fetchSourceRecordSaveStatus(
  sourceRecordId: string,
  init?: { signal?: AbortSignal },
): Promise<SourceRecordSaveStatus> {
  return apiRequest(`/api/library/source-records/${encodeURIComponent(sourceRecordId)}`, {
    schema: sourceRecordSaveStatusSchema,
    signal: init?.signal,
  });
}

export const SOURCE_RECORD_SAVE_POLL_MS = 2_000;

export function saveStatusRefetchInterval(query: { state: { data?: SourceRecordSaveStatus } }): number | false {
  return query.state.data?.status === 'pending' ? SOURCE_RECORD_SAVE_POLL_MS : false;
}

export function useSourceRecordSaveStatusQuery(
  sourceRecordId: string | null,
  options?: { enabled?: boolean; userId?: string | null },
) {
  const session = authClient.useSession();
  const userId = options?.userId !== undefined ? options.userId : (session.data?.user.id ?? null);
  return useQuery({
    queryKey: discoverQueryKey.saveStatus(sourceRecordId ?? 'none', userId),
    queryFn: ({ signal }) => fetchSourceRecordSaveStatus(sourceRecordId!, { signal }),
    refetchInterval: saveStatusRefetchInterval,
    enabled: (options?.enabled ?? true) && userId !== null && Boolean(sourceRecordId),
  });
}

export function useDiscoverRecordsQuery(
  params: DiscoverListParams,
  options?: { enabled?: boolean; userId?: string | null },
) {
  const session = authClient.useSession();
  const userId = options?.userId !== undefined ? options.userId : (session.data?.user.id ?? null);
  return useQuery({
    queryKey: discoverQueryKey.records(params, userId),
    queryFn: ({ signal }) => fetchDiscoverRecords(params, { signal }),
    placeholderData: (data, previousQuery) => (previousQuery?.queryKey[2] === userId ? data : undefined),
    enabled: options?.enabled ?? true,
  });
}

export function useDiscoverSourcesQuery() {
  return useQuery({
    queryKey: discoverQueryKey.sources(),
    queryFn: ({ signal }) => fetchDiscoverSources({ signal }),
  });
}

export function useDiscoverFacetsQuery(sourceKey?: string | null) {
  return useQuery({
    queryKey: discoverQueryKey.facets(sourceKey),
    queryFn: ({ signal }) => fetchDiscoverFacets(sourceKey ?? undefined, { signal }),
    enabled: Boolean(sourceKey),
  });
}

export const formatDiscoverApiError = formatApiError;
