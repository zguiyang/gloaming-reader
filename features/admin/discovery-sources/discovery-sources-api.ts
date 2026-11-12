import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type DiscoverySourceListData,
  discoverySourceListDataSchema,
  type DiscoverySourceSummary,
  discoverySourceSummarySchema,
} from '@/shared/discovery';

import { apiRequest, formatApiError } from '@/lib/api-request';

export const discoverySourcesQueryKey = ['admin', 'discovery-sources'] as const;

export async function listAdminDiscoverySources(init?: { signal?: AbortSignal }): Promise<DiscoverySourceListData> {
  return apiRequest('/api/admin/discovery/sources', {
    schema: discoverySourceListDataSchema,
    signal: init?.signal,
  });
}

export async function setDiscoverySourceEnabled(sourceKey: string, enabled: boolean): Promise<DiscoverySourceSummary> {
  return apiRequest(`/api/admin/discovery/sources/${encodeURIComponent(sourceKey)}`, {
    method: 'PATCH',
    json: { enabled },
    schema: discoverySourceSummarySchema,
  });
}

export function useDiscoverySourcesQuery() {
  return useQuery({
    queryKey: discoverySourcesQueryKey,
    queryFn: ({ signal }) => listAdminDiscoverySources({ signal }),
  });
}

export function useSetDiscoverySourceEnabledMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceKey, enabled }: { sourceKey: string; enabled: boolean }) =>
      setDiscoverySourceEnabled(sourceKey, enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: discoverySourcesQueryKey });
      void queryClient.invalidateQueries({ queryKey: ['discover', 'sources'] });
    },
  });
}

export const formatDiscoverySourcesApiError = formatApiError;
