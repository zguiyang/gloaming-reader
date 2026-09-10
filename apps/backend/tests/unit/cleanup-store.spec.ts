import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ASSET_CLEANUP_FAILED_SAMPLE_LIMIT, type AssetCleanupFailure } from '@gloaming/shared/assets';

const redisState = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, _ex?: string, _ttl?: number, nx?: string) => {
      if (nx === 'NX' && values.has(key)) return null;
      values.set(key, value);
      return 'OK';
    }),
    eval: vi.fn(async (script: string, numKeys: number, ...rawArgs: Array<string | number>) => {
      const args = rawArgs.map(String);
      const keys = args.slice(0, numKeys);
      const argv = args.slice(numKeys);
      const lockValue = values.get(keys[0] ?? '');
      if (script.includes('EXPIRE')) {
        return lockValue === argv[0] ? 1 : 0;
      }
      if (script.includes('DEL')) {
        if (lockValue !== argv[0]) return 0;
        values.delete(keys[0]!);
        return 1;
      }
      if (numKeys >= 3) {
        if (lockValue !== argv[0]) return 0;
        values.set(keys[1]!, argv[1]!);
        values.set(keys[2]!, argv[2]!);
        return 1;
      }
      return 0;
    }),
    clear() {
      values.clear();
      this.get.mockClear();
      this.set.mockClear();
      this.eval.mockClear();
    },
  };
});

vi.mock('@/lib/redis', () => ({
  getRedis: () => ({
    get: redisState.get,
    set: redisState.set,
    eval: redisState.eval,
  }),
}));

import {
  acquireLock,
  applyCleanupRetryState,
  CLEANUP_LOCK_KEY,
  type CleanupJobRecord,
  collectCleanupRetryKeys,
  createQueuedCleanupJob,
  loadCleanupJob,
  loadCleanupJobIdForScan,
  releaseLock,
  renewLock,
  saveCleanupJob,
  startLockRenewal,
  toPublicCleanupJob,
} from '@/modules/asset-management/cleanup-store';

function sampleRecord(overrides: Partial<CleanupJobRecord> = {}): CleanupJobRecord {
  const now = '2026-09-10T00:00:00.000Z';
  return {
    jobId: 'asset-cleanup:scan_1',
    scanId: 'scan_1',
    status: 'partial',
    requestedCount: 4,
    processedCount: 3,
    deletedCount: 2,
    skippedReferencedCount: 0,
    failedCount: 1,
    deletedBytes: 30,
    failed: [{ key: 'orphan/fail.bin', error: 'AccessDenied' }],
    pendingKeys: ['orphan/pending.bin'],
    sizeByKey: {
      'orphan/ok.bin': 10,
      'orphan/fail.bin': 10,
      'orphan/pending.bin': 10,
      'orphan/done.bin': 10,
    },
    attempt: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('cleanup lock token fencing', () => {
  beforeEach(() => {
    redisState.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('isolates renew and release to the owning executionToken', async () => {
    const first = 'execution-a';
    const second = 'execution-b';
    expect(await acquireLock(CLEANUP_LOCK_KEY, first, 30)).toBe(true);
    expect(await acquireLock(CLEANUP_LOCK_KEY, second, 30)).toBe(false);

    expect(await renewLock(CLEANUP_LOCK_KEY, second, 30)).toBe(false);
    expect(await renewLock(CLEANUP_LOCK_KEY, first, 30)).toBe(true);

    await releaseLock(CLEANUP_LOCK_KEY, second);
    expect(await renewLock(CLEANUP_LOCK_KEY, first, 30)).toBe(true);

    await releaseLock(CLEANUP_LOCK_KEY, first);
    expect(await acquireLock(CLEANUP_LOCK_KEY, second, 30)).toBe(true);
    expect(await renewLock(CLEANUP_LOCK_KEY, first, 30)).toBe(false);
  });

  it('saves job state when the execution token still owns the lock', async () => {
    const token = 'execution-owner';
    expect(await acquireLock(CLEANUP_LOCK_KEY, token, 30)).toBe(true);
    const record = sampleRecord({ status: 'running' });

    expect(await saveCleanupJob(record, { executionToken: token })).toBe(true);
    await expect(loadCleanupJob(record.jobId)).resolves.toMatchObject({
      jobId: record.jobId,
      status: 'running',
    });
    await expect(loadCleanupJobIdForScan(record.scanId)).resolves.toBe(record.jobId);
  });

  it('refuses owned save when the cleanup lock is missing', async () => {
    const record = sampleRecord({ status: 'failed' });
    expect(await saveCleanupJob(record, { executionToken: 'orphan-token' })).toBe(false);
    await expect(loadCleanupJob(record.jobId)).resolves.toBeNull();
    await expect(loadCleanupJobIdForScan(record.scanId)).resolves.toBeNull();
  });

  it('refuses owned save when another token holds the lock', async () => {
    expect(await acquireLock(CLEANUP_LOCK_KEY, 'new-token', 30)).toBe(true);
    const record = sampleRecord({ status: 'failed' });

    expect(await saveCleanupJob(record, { executionToken: 'old-token' })).toBe(false);
    await expect(loadCleanupJob(record.jobId)).resolves.toBeNull();
  });

  it('does not let an old worker token overwrite a newer worker job state', async () => {
    const oldToken = 'worker-a';
    const newToken = 'worker-b';
    expect(await acquireLock(CLEANUP_LOCK_KEY, oldToken, 30)).toBe(true);
    const record = sampleRecord({ status: 'running' });
    expect(await saveCleanupJob(record, { executionToken: oldToken })).toBe(true);

    redisState.values.set(CLEANUP_LOCK_KEY, newToken);
    const newer = sampleRecord({ status: 'completed', pendingKeys: [], processedCount: 4, failed: [] });
    expect(await saveCleanupJob(newer, { executionToken: newToken })).toBe(true);

    const stale = sampleRecord({ status: 'failed', error: 'Cleanup lock renewal failed' });
    expect(await saveCleanupJob(stale, { executionToken: oldToken })).toBe(false);

    const loaded = await loadCleanupJob(record.jobId);
    expect(loaded?.status).toBe('completed');
    expect(loaded?.error).toBeUndefined();
  });

  it('does not let an old worker delete or renew a newer worker lock', async () => {
    const oldToken = 'worker-a';
    const newToken = 'worker-b';
    expect(await acquireLock(CLEANUP_LOCK_KEY, oldToken, 30)).toBe(true);
    redisState.values.set(CLEANUP_LOCK_KEY, newToken);

    expect(await renewLock(CLEANUP_LOCK_KEY, oldToken, 30)).toBe(false);
    await releaseLock(CLEANUP_LOCK_KEY, oldToken);
    expect(await renewLock(CLEANUP_LOCK_KEY, newToken, 30)).toBe(true);
    expect(redisState.values.get(CLEANUP_LOCK_KEY)).toBe(newToken);
  });

  it('allows unprotected saves for API enqueue and retry without a cleanup lock', async () => {
    const record = createQueuedCleanupJob({
      scanId: 'scan_api',
      pendingKeys: ['orphan/a.bin'],
      sizeByKey: { 'orphan/a.bin': 1 },
    });
    await saveCleanupJob(record);
    await expect(loadCleanupJob(record.jobId)).resolves.toMatchObject({
      status: 'queued',
      scanId: 'scan_api',
    });
  });

  it('marks renewal failed when a different token holds the lock', async () => {
    vi.useFakeTimers();
    expect(await acquireLock(CLEANUP_LOCK_KEY, 'old-token', 15)).toBe(true);
    const renewal = startLockRenewal(CLEANUP_LOCK_KEY, 'old-token', 15);

    redisState.values.set(CLEANUP_LOCK_KEY, 'new-token');
    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.resolve();

    expect(renewal.failed()).toBe(true);
    renewal.stop();
  });

  it('marks renewal failed when renewLock rejects', async () => {
    vi.useFakeTimers();
    expect(await acquireLock(CLEANUP_LOCK_KEY, 'token', 15)).toBe(true);
    const renewal = startLockRenewal(CLEANUP_LOCK_KEY, 'token', 15);
    redisState.eval.mockRejectedValueOnce(new Error('redis unavailable'));

    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.resolve();

    expect(renewal.failed()).toBe(true);
    renewal.stop();
  });
});

describe('cleanup retry state', () => {
  it('keeps pending keys when failed keys also exist', () => {
    const record = sampleRecord();
    const retryKeys = collectCleanupRetryKeys(record);
    expect(retryKeys).toEqual(['orphan/fail.bin', 'orphan/pending.bin']);

    const deletedCount = record.deletedCount;
    applyCleanupRetryState(record, retryKeys);

    expect(record.pendingKeys).toEqual(['orphan/fail.bin', 'orphan/pending.bin']);
    expect(record.failed).toEqual([]);
    expect(record.failedCount).toBe(0);
    expect(record.requestedCount).toBe(4);
    expect(record.processedCount).toBe(2);
    expect(record.processedCount).toBeLessThanOrEqual(record.requestedCount);
    expect(record.deletedCount).toBe(deletedCount);
    expect(record.status).toBe('queued');
    expect(record.attempt).toBe(2);
  });

  it('deduplicates overlapping failed and pending keys', () => {
    const record = sampleRecord({
      failed: [{ key: 'orphan/shared.bin', error: 'timeout' }],
      pendingKeys: ['orphan/shared.bin', 'orphan/later.bin'],
      requestedCount: 3,
    });
    const retryKeys = collectCleanupRetryKeys(record);
    applyCleanupRetryState(record, retryKeys);
    expect(record.pendingKeys).toEqual(['orphan/shared.bin', 'orphan/later.bin']);
    expect(record.processedCount).toBe(1);
  });
});

describe('toPublicCleanupJob', () => {
  it('projects a bounded failedSample and keeps the full internal list', () => {
    const failed: AssetCleanupFailure[] = Array.from({ length: 60 }, (_, index) => ({
      key: `orphan/${index}.bin`,
      error: 'fail',
    }));
    const record = sampleRecord({
      failed,
      failedCount: failed.length,
      requestedCount: 60,
      processedCount: 60,
    });

    const publicJob = toPublicCleanupJob(record);
    expect(record.failed).toHaveLength(60);
    expect(publicJob.failedCount).toBe(60);
    expect(publicJob.failedSample).toHaveLength(ASSET_CLEANUP_FAILED_SAMPLE_LIMIT);
    expect(publicJob.failedSample[0]?.key).toBe('orphan/0.bin');
    expect('failed' in publicJob).toBe(false);
  });

  it('builds a queued public job from createQueuedCleanupJob', () => {
    const record = createQueuedCleanupJob({
      scanId: 'scan_new',
      pendingKeys: ['a', 'b'],
      sizeByKey: { a: 1, b: 2 },
    });
    const publicJob = toPublicCleanupJob(record);
    expect(publicJob.status).toBe('queued');
    expect(publicJob.requestedCount).toBe(2);
    expect(publicJob.failedSample).toEqual([]);
    expect(publicJob.failedCount).toBe(0);
  });
});
