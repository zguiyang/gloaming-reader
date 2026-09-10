import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  AssetCleanupJob,
  AssetCleanupJobAccepted,
  AssetObjectListData,
  AssetObjectListQuery,
  AssetScanReport,
} from '@gloaming/shared/assets';
import {
  assetCleanupJobAcceptedSchema,
  assetCleanupJobSchema,
  assetObjectListDataSchema,
  assetScanReportSchema,
} from '@gloaming/shared/assets';

import { shouldPollCleanupJob } from '@/features/admin/assets/assets-cleanup-state';
import { apiRequest, formatApiError } from '@/lib/api-request';

const OBJECTS_GC_TIME_MS = 5 * 60 * 1000;

export const assetsQueryKey = {
  all: ['admin', 'assets'] as const,
  scan: (scanId: string) => [...assetsQueryKey.all, 'scan', scanId] as const,
  objects: (scanId: string, query: AssetObjectListQuery) => [...assetsQueryKey.all, 'objects', scanId, query] as const,
  job: (jobId: string) => [...assetsQueryKey.all, 'cleanup-job', jobId] as const,
};

export async function scanAssets(init?: { signal?: AbortSignal }): Promise<AssetScanReport> {
  return apiRequest('/api/admin/assets/scan', {
    method: 'POST',
    schema: assetScanReportSchema,
    signal: init?.signal,
  });
}

export async function listScanObjects(
  scanId: string,
  query: AssetObjectListQuery,
  init?: { signal?: AbortSignal },
): Promise<AssetObjectListData> {
  const search = new URLSearchParams();
  search.set('page', String(query.page));
  search.set('pageSize', String(query.pageSize));
  search.set('sortBy', query.sortBy);
  search.set('sortOrder', query.sortOrder);
  search.set('status', query.status);
  search.set('category', query.category);
  return apiRequest(`/api/admin/assets/scans/${encodeURIComponent(scanId)}/objects?${search}`, {
    schema: assetObjectListDataSchema,
    signal: init?.signal,
  });
}

export async function enqueueOrphanCleanup(scanId: string): Promise<AssetCleanupJobAccepted> {
  return apiRequest(`/api/admin/assets/scans/${encodeURIComponent(scanId)}/cleanup`, {
    method: 'POST',
    json: { confirmed: true },
    schema: assetCleanupJobAcceptedSchema,
  });
}

export async function getCleanupJob(jobId: string, init?: { signal?: AbortSignal }): Promise<AssetCleanupJob> {
  return apiRequest(`/api/admin/assets/cleanup-jobs/${encodeURIComponent(jobId)}`, {
    schema: assetCleanupJobSchema,
    signal: init?.signal,
  });
}

export async function retryCleanupJob(jobId: string): Promise<AssetCleanupJobAccepted> {
  return apiRequest(`/api/admin/assets/cleanup-jobs/${encodeURIComponent(jobId)}/retry`, {
    method: 'POST',
    json: { confirmed: true },
    schema: assetCleanupJobAcceptedSchema,
  });
}

export function useScanAssetsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => scanAssets(),
    onSuccess: (report) => {
      queryClient.removeQueries({
        queryKey: [...assetsQueryKey.all, 'objects'],
        predicate: (query) => query.queryKey[3] !== report.scanId,
      });
      queryClient.setQueryData(assetsQueryKey.scan(report.scanId), report);
    },
  });
}

export function useScanObjectsQuery(scanId: string | null, query: AssetObjectListQuery) {
  return useQuery({
    queryKey: scanId ? assetsQueryKey.objects(scanId, query) : [...assetsQueryKey.all, 'objects', 'idle'],
    queryFn: ({ signal }) => listScanObjects(scanId!, query, { signal }),
    enabled: Boolean(scanId),
    gcTime: OBJECTS_GC_TIME_MS,
  });
}

export function useCleanupJobQuery(jobId: string | null) {
  return useQuery({
    queryKey: jobId ? assetsQueryKey.job(jobId) : [...assetsQueryKey.all, 'cleanup-job', 'idle'],
    queryFn: ({ signal }) => getCleanupJob(jobId!, { signal }),
    enabled: Boolean(jobId),
    refetchInterval: (query) => (shouldPollCleanupJob(query.state.data?.status) ? 1500 : false),
  });
}

export function useEnqueueOrphanCleanupMutation() {
  return useMutation({
    mutationFn: (scanId: string) => enqueueOrphanCleanup(scanId),
  });
}

export function useRetryCleanupJobMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => retryCleanupJob(jobId),
    onSuccess: (accepted) => {
      queryClient.setQueryData(assetsQueryKey.job(accepted.jobId), (current: AssetCleanupJob | undefined) =>
        current ? { ...current, status: accepted.status } : current,
      );
      void queryClient.invalidateQueries({ queryKey: assetsQueryKey.job(accepted.jobId) });
    },
  });
}

export const formatAssetsApiError = formatApiError;
