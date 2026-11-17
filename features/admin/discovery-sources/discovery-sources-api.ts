import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type DiscoverySourceSettingsUpdate,
  type DiscoverySourceStatus,
  type DiscoverySourceStatusListData,
  discoverySourceStatusListDataSchema,
  discoverySourceStatusSchema,
  type DiscoverySyncRunHistory,
  discoverySyncRunHistorySchema,
  type DiscoverySyncTriggerResultData,
  discoverySyncTriggerResultSchema,
} from '@/shared/discovery';

import { apiRequest, formatApiError } from '@/lib/api-request';

export const discoverySourcesQueryKey = ['admin', 'discovery-sources'] as const;

export function discoverySourceRunsQueryKey(sourceKey: string) {
  return ['admin', 'discovery-sources', sourceKey, 'sync-runs'] as const;
}

export async function listAdminDiscoverySourceStatuses(init?: {
  signal?: AbortSignal;
}): Promise<DiscoverySourceStatusListData> {
  return apiRequest('/api/admin/discovery/sources', {
    schema: discoverySourceStatusListDataSchema,
    signal: init?.signal,
  });
}

export async function updateDiscoverySourceSettings(
  sourceKey: string,
  patch: DiscoverySourceSettingsUpdate,
): Promise<DiscoverySourceStatus> {
  return apiRequest(`/api/admin/discovery/sources/${encodeURIComponent(sourceKey)}`, {
    method: 'PATCH',
    json: patch,
    schema: discoverySourceStatusSchema,
  });
}

export async function triggerDiscoverySourceSync(
  sourceKey: string,
  input: { force?: boolean } = {},
): Promise<DiscoverySyncTriggerResultData> {
  return apiRequest(`/api/admin/discovery/sources/${encodeURIComponent(sourceKey)}/sync`, {
    method: 'POST',
    json: input,
    schema: discoverySyncTriggerResultSchema,
  });
}

export async function listDiscoverySourceSyncRuns(
  sourceKey: string,
  init?: { signal?: AbortSignal },
): Promise<DiscoverySyncRunHistory> {
  return apiRequest(`/api/admin/discovery/sources/${encodeURIComponent(sourceKey)}/sync/runs`, {
    schema: discoverySyncRunHistorySchema,
    signal: init?.signal,
  });
}

export function useDiscoverySourcesQuery() {
  return useQuery({
    queryKey: discoverySourcesQueryKey,
    queryFn: ({ signal }) => listAdminDiscoverySourceStatuses({ signal }),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const busy = items.some((item) => item.syncStatus === 'queued' || item.syncStatus === 'syncing');
      return busy ? 5_000 : false;
    },
  });
}

export function useDiscoverySourceRunsQuery(sourceKey: string, enabled: boolean) {
  return useQuery({
    queryKey: discoverySourceRunsQueryKey(sourceKey),
    queryFn: ({ signal }) => listDiscoverySourceSyncRuns(sourceKey, { signal }),
    enabled,
  });
}

export function useUpdateDiscoverySourceSettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceKey, patch }: { sourceKey: string; patch: DiscoverySourceSettingsUpdate }) =>
      updateDiscoverySourceSettings(sourceKey, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: discoverySourcesQueryKey });
      void queryClient.invalidateQueries({ queryKey: ['discover', 'sources'] });
    },
  });
}

export function useTriggerDiscoverySourceSyncMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceKey, force }: { sourceKey: string; force?: boolean }) =>
      triggerDiscoverySourceSync(sourceKey, { force }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: discoverySourcesQueryKey });
      void queryClient.invalidateQueries({ queryKey: discoverySourceRunsQueryKey(variables.sourceKey) });
    },
  });
}

export const formatDiscoverySourcesApiError = formatApiError;
