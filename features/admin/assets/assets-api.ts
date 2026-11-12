import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { AssetCleanupJob, AssetCleanupJobAccepted, AssetScanReport } from '@/shared/assets';
import { assetCleanupJobAcceptedSchema, assetCleanupJobSchema, assetScanReportSchema } from '@/shared/assets';

import { shouldPollCleanupJob } from '@/features/admin/assets/assets-cleanup-state';
import { apiRequest, ApiRequestError, formatApiError } from '@/lib/api-request';

export const assetsQueryKey = {
  all: ['admin', 'assets'] as const,
  latestScan: () => [...assetsQueryKey.all, 'scan', 'latest'] as const,
  scan: (scanId: string) => [...assetsQueryKey.all, 'scan', scanId] as const,
  job: (jobId: string) => [...assetsQueryKey.all, 'cleanup-job', jobId] as const,
};

export function isAssetsScanNotFoundError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 404;
}

export async function getLatestScanReport(init?: { signal?: AbortSignal }): Promise<AssetScanReport> {
  return apiRequest('/api/admin/assets/scan/latest', {
    schema: assetScanReportSchema,
    signal: init?.signal,
  });
}

export async function scanAssets(init?: { signal?: AbortSignal }): Promise<AssetScanReport> {
  return apiRequest('/api/admin/assets/scan', {
    method: 'POST',
    schema: assetScanReportSchema,
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

export function useLatestScanQuery() {
  return useQuery({
    queryKey: assetsQueryKey.latestScan(),
    queryFn: ({ signal }) => getLatestScanReport({ signal }),
    retry: false,
    staleTime: 30_000,
  });
}

export function useScanAssetsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => scanAssets(),
    onSuccess: (report) => {
      queryClient.setQueryData(assetsQueryKey.scan(report.scanId), report);
      queryClient.setQueryData(assetsQueryKey.latestScan(), report);
    },
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
