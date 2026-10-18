import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import {
  type DiscoverySourceStatus,
  discoverySourceStatusSchema,
  type DiscoverySyncRunHistory,
  discoverySyncRunHistorySchema,
  discoverySyncTriggerResultSchema,
  isDiscoverySyncRunPending,
} from '@gloaming/shared/discovery';

import { apiRequest, formatApiError } from '@/lib/api-request';

/** V1 admin controls a single source: Project Gutenberg. */
const PROJECT_GUTENBERG_SOURCE_PATH = '/api/admin/discovery/sources/project-gutenberg';

export const discoverySourcesQueryKey = ['admin', 'discovery-sources', 'project-gutenberg'] as const;
export const discoverySyncHistoryQueryKey = [...discoverySourcesQueryKey, 'sync-runs'] as const;

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

export async function getDiscoverySyncRunHistory(init?: { signal?: AbortSignal }): Promise<DiscoverySyncRunHistory> {
  return apiRequest(`${PROJECT_GUTENBERG_SOURCE_PATH}/sync/runs`, {
    schema: discoverySyncRunHistorySchema,
    signal: init?.signal,
  });
}

/**
 * Bounded recent-run history. Refreshed while the status query reports a
 * non-terminal run; when the run transitions from pending to a terminal stage,
 * one final refresh is forced so the history cannot be left showing the stale
 * pending entry.
 */
export function useDiscoverySyncRunHistoryQuery(status?: DiscoverySourceStatus) {
  const run = status?.currentRun.run;
  const isRunPending = Boolean(run && isDiscoverySyncRunPending(run.stage));
  const queryClient = useQueryClient();
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isRunPending) {
      // The run just reached a terminal stage: pull the updated history once.
      void queryClient.invalidateQueries({ queryKey: discoverySyncHistoryQueryKey });
    }
    wasPending.current = isRunPending;
  }, [isRunPending, queryClient]);
  return useQuery({
    queryKey: discoverySyncHistoryQueryKey,
    queryFn: ({ signal }) => getDiscoverySyncRunHistory({ signal }),
    refetchInterval: isRunPending ? 2000 : false,
    refetchOnWindowFocus: true,
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
      void queryClient.invalidateQueries({ queryKey: discoverySyncHistoryQueryKey });
    },
  });
}

export const formatDiscoverySourcesApiError = formatApiError;
