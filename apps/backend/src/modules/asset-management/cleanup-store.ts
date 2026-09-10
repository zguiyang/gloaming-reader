import {
  type AssetCleanupFailure,
  type AssetCleanupJob,
  type AssetCleanupJobStatus,
  publicFailedSample,
} from '@gloaming/shared/assets';

import { env } from '@/lib/env';
import { getRedis } from '@/lib/redis';

const JOB_KEY_PREFIX = 'asset-management:cleanup:job:';
const SCAN_JOB_KEY_PREFIX = 'asset-management:cleanup:scan:';
export const CLEANUP_LOCK_KEY = 'asset-management:cleanup:lock';
export const SCAN_LOCK_KEY = 'asset-management:scan:lock';

export const CLEANUP_BATCH_SIZE = 100;
export const CLEANUP_LOCK_TTL_SECONDS = 120;
export const SCAN_LOCK_TTL_SECONDS = 120;

export type LockRenewalHandle = {
  stop: () => void;
  failed: () => boolean;
};

/** Internal Redis record keeps the full failure list; public jobs expose a sample. */
export type CleanupJobRecord = Omit<AssetCleanupJob, 'failedSample'> & {
  pendingKeys: string[];
  sizeByKey: Record<string, number>;
  attempt: number;
  failed: AssetCleanupFailure[];
};

const RENEW_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/** Atomically: verify lock token, write job payload, update scan mapping, set TTLs. */
const SAVE_OWNED_JOB_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[4])
redis.call('SET', KEYS[3], ARGV[3], 'EX', ARGV[4])
return 1
`;

export type SaveCleanupJobOptions = {
  executionToken: string;
};

export function snapshotTtlSeconds(): number {
  return env.NODE_ENV === 'production' ? 7 * 24 * 60 * 60 : 24 * 60 * 60;
}

export function cleanupJobIdForScan(scanId: string): string {
  return `asset-cleanup:${scanId}`;
}

function jobRedisKey(jobId: string): string {
  return `${JOB_KEY_PREFIX}${jobId}`;
}

function scanJobRedisKey(scanId: string): string {
  return `${SCAN_JOB_KEY_PREFIX}${scanId}`;
}

export async function acquireLock(lockKey: string, token: string, ttlSeconds: number): Promise<boolean> {
  const locked = await getRedis().set(lockKey, token, 'EX', ttlSeconds, 'NX');
  return locked === 'OK';
}

export async function renewLock(lockKey: string, token: string, ttlSeconds: number): Promise<boolean> {
  const result = await getRedis().eval(RENEW_LOCK_SCRIPT, 1, lockKey, token, String(ttlSeconds));
  return result === 1;
}

export async function releaseLock(lockKey: string, token: string): Promise<void> {
  await getRedis().eval(RELEASE_LOCK_SCRIPT, 1, lockKey, token);
}

export function startLockRenewal(lockKey: string, token: string, ttlSeconds: number): LockRenewalHandle {
  let failed = false;
  let stopped = false;
  const intervalMs = Math.max(5_000, Math.floor((ttlSeconds * 1000) / 3));
  const timer = setInterval(() => {
    if (stopped || failed) return;
    void renewLock(lockKey, token, ttlSeconds)
      .then((renewed) => {
        if (!renewed && !stopped) {
          failed = true;
        }
      })
      .catch(() => {
        if (!stopped) {
          failed = true;
        }
      });
  }, intervalMs);
  timer.unref?.();
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    failed: () => failed,
  };
}

export async function loadCleanupJob(jobId: string): Promise<CleanupJobRecord | null> {
  const raw = await getRedis().get(jobRedisKey(jobId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CleanupJobRecord;
  } catch {
    return null;
  }
}

export async function loadCleanupJobIdForScan(scanId: string): Promise<string | null> {
  return getRedis().get(scanJobRedisKey(scanId));
}

export async function saveCleanupJob(record: CleanupJobRecord): Promise<void>;
export async function saveCleanupJob(record: CleanupJobRecord, options: SaveCleanupJobOptions): Promise<boolean>;
export async function saveCleanupJob(
  record: CleanupJobRecord,
  options?: SaveCleanupJobOptions,
): Promise<boolean | void> {
  const ttl = snapshotTtlSeconds();
  const redis = getRedis();
  const payload = JSON.stringify({ ...record, updatedAt: new Date().toISOString() });
  const jobKey = jobRedisKey(record.jobId);
  const scanKey = scanJobRedisKey(record.scanId);

  if (options) {
    const result = await redis.eval(
      SAVE_OWNED_JOB_SCRIPT,
      3,
      CLEANUP_LOCK_KEY,
      jobKey,
      scanKey,
      options.executionToken,
      payload,
      record.jobId,
      String(ttl),
    );
    return result === 1;
  }

  await redis.set(jobKey, payload, 'EX', ttl);
  await redis.set(scanKey, record.jobId, 'EX', ttl);
}

export function toPublicCleanupJob(record: CleanupJobRecord): AssetCleanupJob {
  return {
    jobId: record.jobId,
    scanId: record.scanId,
    status: record.status,
    requestedCount: record.requestedCount,
    processedCount: record.processedCount,
    deletedCount: record.deletedCount,
    skippedReferencedCount: record.skippedReferencedCount,
    failedCount: record.failed.length,
    deletedBytes: record.deletedBytes,
    failedSample: publicFailedSample(record.failed),
    verification: record.verification,
    error: record.error,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function createQueuedCleanupJob(input: {
  scanId: string;
  pendingKeys: string[];
  sizeByKey: Record<string, number>;
}): CleanupJobRecord {
  const now = new Date().toISOString();
  return {
    jobId: cleanupJobIdForScan(input.scanId),
    scanId: input.scanId,
    status: 'queued',
    requestedCount: input.pendingKeys.length,
    processedCount: 0,
    deletedCount: 0,
    skippedReferencedCount: 0,
    failedCount: 0,
    deletedBytes: 0,
    failed: [],
    pendingKeys: input.pendingKeys,
    sizeByKey: input.sizeByKey,
    attempt: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function isInFlightStatus(status: AssetCleanupJobStatus): boolean {
  return status === 'queued' || status === 'running';
}

export function isRetryableStatus(status: AssetCleanupJobStatus): boolean {
  return status === 'partial' || status === 'failed';
}

export function mergeFailures(existing: AssetCleanupFailure[], incoming: AssetCleanupFailure[]): AssetCleanupFailure[] {
  const byKey = new Map(existing.map((entry) => [entry.key, entry]));
  for (const entry of incoming) {
    byKey.set(entry.key, entry);
  }
  return [...byKey.values()];
}

/** Keys that must be retried: remaining failures plus keys not yet processed. */
export function collectCleanupRetryKeys(record: CleanupJobRecord): string[] {
  return [...new Set([...record.failed.map((entry) => entry.key), ...record.pendingKeys])];
}

/** Reset current-batch progress for a retry without shrinking lifetime stats or requestedCount. */
export function applyCleanupRetryState(record: CleanupJobRecord, retryKeys: string[]): void {
  record.pendingKeys = retryKeys;
  record.processedCount = Math.max(0, record.requestedCount - retryKeys.length);
  record.failed = [];
  record.failedCount = 0;
  record.status = 'queued';
  record.error = undefined;
  record.verification = undefined;
  record.attempt += 1;
}
