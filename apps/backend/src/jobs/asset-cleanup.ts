import { runAssetCleanupJob } from '@/modules/asset-management/cleanup-job';

export const JOB_ASSET_CLEANUP = 'asset-cleanup';

export async function processAssetCleanup(data: { jobId: string; scanId: string }): Promise<{ ok: true }> {
  return runAssetCleanupJob(data);
}
