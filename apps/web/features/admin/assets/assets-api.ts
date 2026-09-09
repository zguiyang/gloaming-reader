import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  AssetCleanupResult,
  AssetObjectListData,
  AssetObjectListQuery,
  AssetScanReport,
} from '@gloaming/shared/assets';
import { assetCleanupResultSchema, assetObjectListDataSchema, assetScanReportSchema } from '@gloaming/shared/assets';

import { apiRequest, formatApiError } from '@/lib/api-request';

export const assetsQueryKey = {
  all: ['admin', 'assets'] as const,
  scan: (scanId: string) => [...assetsQueryKey.all, 'scan', scanId] as const,
  objects: (scanId: string, query: AssetObjectListQuery) => [...assetsQueryKey.all, 'objects', scanId, query] as const,
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

export async function cleanupOrphanAssets(scanId: string): Promise<AssetCleanupResult> {
  return apiRequest(`/api/admin/assets/scans/${encodeURIComponent(scanId)}/cleanup`, {
    method: 'POST',
    json: { confirmed: true },
    schema: assetCleanupResultSchema,
  });
}

export function useScanAssetsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => scanAssets(),
    onSuccess: (report) => {
      queryClient.setQueryData(assetsQueryKey.scan(report.scanId), report);
    },
  });
}

export function useScanObjectsQuery(scanId: string | null, query: AssetObjectListQuery) {
  return useQuery({
    queryKey: scanId ? assetsQueryKey.objects(scanId, query) : [...assetsQueryKey.all, 'objects', 'idle'],
    queryFn: ({ signal }) => listScanObjects(scanId!, query, { signal }),
    enabled: Boolean(scanId),
  });
}

export function useCleanupOrphanAssetsMutation() {
  return useMutation({
    mutationFn: (scanId: string) => cleanupOrphanAssets(scanId),
  });
}

export const formatAssetsApiError = formatApiError;
