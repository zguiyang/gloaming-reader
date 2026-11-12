import type { AssetCleanupJob, AssetCleanupJobStatus, AssetCleanupJobVerification } from '@gloaming/shared/assets';

export const ASSET_CLEANUP_JOB_STORAGE_KEY = 'gloaming.admin.assets.cleanupJob.v1';

export type AssetsPageStatus =
  | 'idle'
  | 'scanning'
  | 'cleanup-queued'
  | 'cleanup-running'
  | 'cleanup-partial'
  | 'cleanup-completed'
  | 'cleanup-failed';

export type StoredCleanupJob = {
  jobId: string;
  scanId: string;
};

export function deriveAssetsPageStatus(input: {
  isScanning: boolean;
  hasReport: boolean;
  job: Pick<AssetCleanupJob, 'status'> | null;
}): AssetsPageStatus {
  if (input.job) {
    return cleanupStatusToPageStatus(input.job.status);
  }
  if (input.isScanning) return 'scanning';
  if (!input.hasReport) return 'idle';
  return 'idle';
}

export function cleanupStatusToPageStatus(status: AssetCleanupJobStatus): AssetsPageStatus {
  switch (status) {
    case 'queued':
      return 'cleanup-queued';
    case 'running':
      return 'cleanup-running';
    case 'partial':
      return 'cleanup-partial';
    case 'completed':
      return 'cleanup-completed';
    case 'failed':
      return 'cleanup-failed';
  }
}

export function canRetryCleanupJob(
  job: Pick<AssetCleanupJob, 'status' | 'failedCount' | 'processedCount' | 'requestedCount'> & {
    verification?: AssetCleanupJobVerification;
  },
): boolean {
  if (job.status !== 'partial' && job.status !== 'failed') return false;
  // Retry only when the server still has failed or unfinished keys. Leftover
  // verification orphans require a new scan, not this job's retry endpoint.
  return job.failedCount > 0 || job.processedCount < job.requestedCount;
}

export function shouldRefreshScanAfterCleanupTransition(
  previous: AssetCleanupJobStatus | undefined,
  next: AssetCleanupJobStatus | undefined,
): boolean {
  if (next !== 'completed' && next !== 'partial' && next !== 'failed') return false;
  return previous === 'queued' || previous === 'running';
}

export function shouldPollCleanupJob(status: AssetCleanupJobStatus | undefined): boolean {
  return status === 'queued' || status === 'running';
}

export function readStoredCleanupJob(): StoredCleanupJob | null {
  try {
    const raw = sessionStorage.getItem(ASSET_CLEANUP_JOB_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCleanupJob;
    if (typeof parsed.jobId !== 'string' || typeof parsed.scanId !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

const cleanupJobListeners = new Set<() => void>();

function emitStoredCleanupJobChange(): void {
  for (const listener of cleanupJobListeners) listener();
}

export function subscribeStoredCleanupJob(listener: () => void): () => void {
  cleanupJobListeners.add(listener);
  return () => {
    cleanupJobListeners.delete(listener);
  };
}

export function getStoredCleanupJobId(): string | null {
  if (typeof window === 'undefined') return null;
  return readStoredCleanupJob()?.jobId ?? null;
}

export function writeStoredCleanupJob(job: StoredCleanupJob): void {
  try {
    sessionStorage.setItem(ASSET_CLEANUP_JOB_STORAGE_KEY, JSON.stringify(job));
  } catch {
    // sessionStorage can throw in private mode
  }
  emitStoredCleanupJobChange();
}

export function clearStoredCleanupJob(): void {
  try {
    sessionStorage.removeItem(ASSET_CLEANUP_JOB_STORAGE_KEY);
  } catch {
    // ignore
  }
  emitStoredCleanupJobChange();
}
