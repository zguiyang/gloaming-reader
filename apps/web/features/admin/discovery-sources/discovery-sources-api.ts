import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type DiscoverySourceStatus,
  discoverySourceStatusSchema,
  discoverySyncTriggerResultSchema,
} from '@gloaming/shared/discovery';

import { apiRequest, formatApiError } from '@/lib/api-request';

/** V1 admin controls a single source: Project Gutenberg. */
const PROJECT_GUTENBERG_SOURCE_PATH = '/api/admin/discovery/sources/project-gutenberg';

export const discoverySourcesQueryKey = ['admin', 'discovery-sources', 'project-gutenberg'] as const;

/** True while a background run is queued or executing. */
export function isDiscoverySyncPending(status: DiscoverySourceStatus['syncStatus']): boolean {
  return status === 'queued' || status === 'syncing';
}

export async function getDiscoverySourceStatus(init?: { signal?: AbortSignal }): Promise<DiscoverySourceStatus> {
  return apiRequest(PROJECT_GUTENBERG_SOURCE_PATH, { schema: discoverySourceStatusSchema, signal: init?.signal });
}

export async function setDiscoverySourceEnabled(enabled: boolean): Promise<DiscoverySourceStatus> {
  return apiRequest(PROJECT_GUTENBERG_SOURCE_PATH, {
    method: 'PATCH',
    json: { enabled },
    schema: discoverySourceStatusSchema,
  });
}

export async function triggerDiscoverySourceSync() {
  return apiRequest(`${PROJECT_GUTENBERG_SOURCE_PATH}/sync`, {
    method: 'POST',
    schema: discoverySyncTriggerResultSchema,
  });
}

/** Polls while a run is pending so the operator sees the background sync finish. */
export function useDiscoverySourceStatusQuery() {
  return useQuery({
    queryKey: discoverySourcesQueryKey,
    queryFn: ({ signal }) => getDiscoverySourceStatus({ signal }),
    refetchInterval: (query) =>
      query.state.data && isDiscoverySyncPending(query.state.data.syncStatus) ? 2000 : false,
  });
}

export function useSetDiscoverySourceEnabledMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => setDiscoverySourceEnabled(enabled),
    onSuccess: (status) => {
      queryClient.setQueryData(discoverySourcesQueryKey, status);
      void queryClient.invalidateQueries({ queryKey: discoverySourcesQueryKey });
    },
  });
}

export function useTriggerDiscoverySourceSyncMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => triggerDiscoverySourceSync(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: discoverySourcesQueryKey });
    },
  });
}

export const formatDiscoverySourcesApiError = formatApiError;
