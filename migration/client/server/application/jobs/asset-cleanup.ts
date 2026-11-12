import { runAssetCleanupJob } from '@/server/domains/assets';
import {
  JOB_PERSONAL_WORK_CLEANUP,
  type PersonalWorkCleanupJobData,
  processPersonalWorkCleanup,
} from '@/server/domains/works/personal/management';

export const JOB_ASSET_CLEANUP = 'asset-cleanup';

export async function processAssetCleanup(data: { jobId: string; scanId: string }): Promise<{ ok: true }> {
  return runAssetCleanupJob(data);
}

export { JOB_PERSONAL_WORK_CLEANUP };

export async function processPersonalWorkCleanupJob(data: PersonalWorkCleanupJobData): Promise<{ ok: true }> {
  return processPersonalWorkCleanup(data);
}
