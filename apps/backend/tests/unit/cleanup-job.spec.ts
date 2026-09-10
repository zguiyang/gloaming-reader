import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ASSET_SCAN_OBJECT_LIMIT } from '@gloaming/shared/assets';

import type * as cleanupStoreModule from '@/modules/asset-management/cleanup-store';
import type { CleanupJobRecord } from '@/modules/asset-management/cleanup-store';
import type * as assetManagementService from '@/modules/asset-management/service';
import type * as ossModule from '@/modules/oss';

const mocks = vi.hoisted(() => {
  const renewal = {
    stop: vi.fn(),
    failed: vi.fn(() => false),
  };
  return {
    renewal,
    acquireLock: vi.fn(async () => true),
    releaseLock: vi.fn(async () => undefined),
    startLockRenewal: vi.fn(() => renewal),
    loadCleanupJob: vi.fn(),
    saveCleanupJob: vi.fn(async () => true),
    collectReferencedStorageKeys: vi.fn(async () => ({
      formalKeys: new Set<string>(),
      legacyAudioSegmentKeys: new Set<string>(),
      externalReferencedKeys: new Set<string>(),
      allReferencedKeys: new Set<string>(),
      kindByKey: new Map<string, string>(),
    })),
    deleteManyObjects: vi.fn(async (keys: string[]) => ({ deleted: keys, failed: [] })),
    listObjects: vi.fn(async () => ({ objects: [] as const, nextCursor: null, hasMore: false })),
  };
});

vi.mock('@/modules/asset-management/cleanup-store', async (importOriginal) => {
  const actual = await importOriginal<typeof cleanupStoreModule>();
  return {
    ...actual,
    acquireLock: mocks.acquireLock,
    releaseLock: mocks.releaseLock,
    startLockRenewal: mocks.startLockRenewal,
    loadCleanupJob: mocks.loadCleanupJob,
    saveCleanupJob: mocks.saveCleanupJob,
  };
});

vi.mock('@/modules/asset-management/service', async (importOriginal) => {
  const actual = await importOriginal<typeof assetManagementService>();
  return {
    ...actual,
    collectReferencedStorageKeys: mocks.collectReferencedStorageKeys,
  };
});

vi.mock('@/modules/oss', async (importOriginal) => {
  const actual = await importOriginal<typeof ossModule>();
  return {
    ...actual,
    deleteManyObjects: mocks.deleteManyObjects,
    listObjects: mocks.listObjects,
  };
});

import { resolveCleanupTerminalStatus, runAssetCleanupJob } from '@/modules/asset-management/cleanup-job';
import { CLEANUP_LOCK_KEY } from '@/modules/asset-management/cleanup-store';

function sampleRecord(overrides: Partial<CleanupJobRecord> = {}): CleanupJobRecord {
  const now = '2026-09-10T00:00:00.000Z';
  return {
    jobId: 'asset-cleanup:scan_job',
    scanId: 'scan_job',
    status: 'queued',
    requestedCount: 2,
    processedCount: 0,
    deletedCount: 0,
    skippedReferencedCount: 0,
    failedCount: 0,
    deletedBytes: 0,
    failed: [],
    pendingKeys: ['orphan/a.bin', 'orphan/b.bin'],
    sizeByKey: { 'orphan/a.bin': 10, 'orphan/b.bin': 20 },
    attempt: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('resolveCleanupTerminalStatus', () => {
  it('completes only when verification ran, scan finished, and no orphans or failures remain', () => {
    expect(
      resolveCleanupTerminalStatus({
        failedCount: 0,
        verification: { ran: true, orphanCount: 0, missingCount: 0, scanComplete: true },
      }),
    ).toBe('completed');
  });

  it('is partial when verification still finds orphans', () => {
    expect(
      resolveCleanupTerminalStatus({
        failedCount: 0,
        verification: { ran: true, orphanCount: 2, missingCount: 0, scanComplete: true },
      }),
    ).toBe('partial');
  });

  it('is partial when the verification scan is incomplete', () => {
    expect(
      resolveCleanupTerminalStatus({
        failedCount: 0,
        verification: { ran: true, orphanCount: 0, missingCount: 0, scanComplete: false },
      }),
    ).toBe('partial');
  });

  it('is partial when failedCount is greater than zero', () => {
    expect(
      resolveCleanupTerminalStatus({
        failedCount: 1,
        verification: { ran: true, orphanCount: 0, missingCount: 0, scanComplete: true },
      }),
    ).toBe('partial');
  });
});

describe('runAssetCleanupJob lock fencing', () => {
  beforeEach(() => {
    mocks.renewal.stop.mockReset();
    mocks.renewal.failed.mockReset();
    mocks.renewal.failed.mockReturnValue(false);
    mocks.acquireLock.mockReset();
    mocks.acquireLock.mockResolvedValue(true);
    mocks.releaseLock.mockReset();
    mocks.releaseLock.mockResolvedValue(undefined);
    mocks.startLockRenewal.mockReset();
    mocks.startLockRenewal.mockReturnValue(mocks.renewal);
    mocks.loadCleanupJob.mockReset();
    mocks.saveCleanupJob.mockReset();
    mocks.saveCleanupJob.mockResolvedValue(true);
    mocks.collectReferencedStorageKeys.mockReset();
    mocks.collectReferencedStorageKeys.mockResolvedValue({
      formalKeys: new Set(),
      legacyAudioSegmentKeys: new Set(),
      externalReferencedKeys: new Set(),
      allReferencedKeys: new Set(),
      kindByKey: new Map(),
    });
    mocks.deleteManyObjects.mockReset();
    mocks.deleteManyObjects.mockImplementation(async (keys: string[]) => ({ deleted: keys, failed: [] }));
    mocks.listObjects.mockReset();
    mocks.listObjects.mockResolvedValue({ objects: [], nextCursor: null, hasMore: false });
  });

  function expectOwnedSaves(token: unknown) {
    expect(mocks.saveCleanupJob.mock.calls.length).toBeGreaterThan(0);
    for (const [, options] of mocks.saveCleanupJob.mock.calls) {
      expect(options).toEqual({ executionToken: token });
    }
  }

  it('uses a unique executionToken and never renews with jobId when acquire fails', async () => {
    const record = sampleRecord();
    mocks.loadCleanupJob.mockResolvedValue(record);
    mocks.acquireLock.mockResolvedValue(false);

    await expect(runAssetCleanupJob({ jobId: record.jobId, scanId: record.scanId })).rejects.toThrow(
      'Another cleanup job holds the cleanup lock',
    );

    expect(mocks.acquireLock).toHaveBeenCalledTimes(1);
    const token = mocks.acquireLock.mock.calls[0]?.[1];
    expect(token).toEqual(expect.any(String));
    expect(token).not.toBe(record.jobId);
    expect(mocks.startLockRenewal).not.toHaveBeenCalled();
    expect(mocks.releaseLock).not.toHaveBeenCalled();
    expect(mocks.deleteManyObjects).not.toHaveBeenCalled();
  });

  it('releases only this execution token in finally', async () => {
    const record = sampleRecord({ pendingKeys: ['orphan/a.bin'], requestedCount: 1 });
    mocks.loadCleanupJob.mockResolvedValue(record);

    await runAssetCleanupJob({ jobId: record.jobId, scanId: record.scanId });

    const token = mocks.acquireLock.mock.calls[0]?.[1];
    expect(mocks.startLockRenewal).toHaveBeenCalledWith(CLEANUP_LOCK_KEY, token, expect.any(Number));
    expect(mocks.releaseLock).toHaveBeenCalledWith(CLEANUP_LOCK_KEY, token);
    expect(token).not.toBe(record.jobId);
  });

  it('does not let a second worker run the same cleanup concurrently', async () => {
    let held = false;
    mocks.acquireLock.mockImplementation(async () => {
      if (held) return false;
      held = true;
      return true;
    });
    mocks.releaseLock.mockImplementation(async () => {
      held = false;
    });

    let releaseFirst: (() => void) | undefined;
    const firstDeleteGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    mocks.deleteManyObjects.mockImplementation(async (keys: string[]) => {
      await firstDeleteGate;
      return { deleted: keys, failed: [] };
    });
    mocks.loadCleanupJob.mockImplementation(async () =>
      sampleRecord({ pendingKeys: ['orphan/a.bin'], requestedCount: 1 }),
    );

    const first = runAssetCleanupJob({ jobId: 'asset-cleanup:scan_job', scanId: 'scan_job' });
    await vi.waitFor(() => expect(mocks.deleteManyObjects).toHaveBeenCalled());

    await expect(runAssetCleanupJob({ jobId: 'asset-cleanup:scan_job', scanId: 'scan_job' })).rejects.toThrow(
      'Another cleanup job holds the cleanup lock',
    );
    expect(mocks.startLockRenewal).toHaveBeenCalledTimes(1);

    releaseFirst?.();
    await first;
  });

  it('stops deleting further batches when lock renewal fails', async () => {
    const pendingKeys = Array.from({ length: 101 }, (_, index) => `orphan/${index}.bin`);
    const record = sampleRecord({
      pendingKeys,
      requestedCount: pendingKeys.length,
      sizeByKey: Object.fromEntries(pendingKeys.map((key) => [key, 1])),
    });
    mocks.loadCleanupJob.mockResolvedValue(record);
    mocks.deleteManyObjects.mockImplementation(async (keys: string[]) => {
      mocks.renewal.failed.mockReturnValue(true);
      return { deleted: keys, failed: [] };
    });

    await expect(runAssetCleanupJob({ jobId: record.jobId, scanId: record.scanId })).rejects.toThrow(
      'Cleanup lock renewal failed',
    );

    expect(mocks.deleteManyObjects).toHaveBeenCalledTimes(1);
    expect(record.status).toBe('partial');
    expect(record.pendingKeys).toHaveLength(1);
    expect(record.error).toBe('Cleanup lock renewal failed');
    expect(mocks.renewal.stop).toHaveBeenCalled();
    expectOwnedSaves(mocks.acquireLock.mock.calls[0]?.[1]);
  });

  it('persists queued to running to completed with the owning execution token', async () => {
    const record = sampleRecord({ pendingKeys: ['orphan/a.bin'], requestedCount: 1 });
    mocks.loadCleanupJob.mockResolvedValue(record);
    const statuses: string[] = [];
    mocks.saveCleanupJob.mockImplementation(async (saved) => {
      statuses.push(saved.status);
      return true;
    });

    await runAssetCleanupJob({ jobId: record.jobId, scanId: record.scanId });

    expect(statuses[0]).toBe('running');
    expect(statuses.at(-1)).toBe('completed');
    expect(record.status).toBe('completed');
    expectOwnedSaves(mocks.acquireLock.mock.calls[0]?.[1]);
  });

  it('persists queued to running to partial when deletes fail', async () => {
    const record = sampleRecord({ pendingKeys: ['orphan/a.bin'], requestedCount: 1 });
    mocks.loadCleanupJob.mockResolvedValue(record);
    const statuses: string[] = [];
    mocks.saveCleanupJob.mockImplementation(async (saved) => {
      statuses.push(saved.status);
      return true;
    });
    mocks.deleteManyObjects.mockResolvedValue({
      deleted: [],
      failed: [{ key: 'orphan/a.bin', error: 'AccessDenied' }],
    });

    await runAssetCleanupJob({ jobId: record.jobId, scanId: record.scanId });

    expect(statuses[0]).toBe('running');
    expect(statuses.at(-1)).toBe('partial');
    expect(record.status).toBe('partial');
    expectOwnedSaves(mocks.acquireLock.mock.calls[0]?.[1]);
  });

  it('does not overwrite a newer worker Redis state after losing the lock in catch', async () => {
    const record = sampleRecord({ pendingKeys: ['orphan/a.bin'], requestedCount: 1 });
    mocks.loadCleanupJob.mockResolvedValue(record);

    let lockOwner: string | null = null;
    let stored: CleanupJobRecord | null = null;
    mocks.acquireLock.mockImplementation(async (_key, token: string) => {
      if (lockOwner) return false;
      lockOwner = token;
      return true;
    });
    mocks.releaseLock.mockImplementation(async (_key, token: string) => {
      if (lockOwner === token) lockOwner = null;
    });
    mocks.saveCleanupJob.mockImplementation(async (next: CleanupJobRecord, options?: { executionToken: string }) => {
      if (!options?.executionToken || options.executionToken !== lockOwner) {
        return false;
      }
      stored = {
        ...next,
        failed: [...next.failed],
        pendingKeys: [...next.pendingKeys],
      };
      return true;
    });
    mocks.deleteManyObjects.mockImplementation(async () => {
      lockOwner = 'worker-b';
      stored = sampleRecord({
        status: 'completed',
        pendingKeys: [],
        processedCount: 1,
        deletedCount: 1,
      });
      throw new Error('S3 timeout');
    });

    await expect(runAssetCleanupJob({ jobId: record.jobId, scanId: record.scanId })).rejects.toThrow('S3 timeout');

    expect(stored?.status).toBe('completed');
    expect(stored?.error).toBeUndefined();
    const releasedToken = mocks.releaseLock.mock.calls[0]?.[1];
    expect(releasedToken).not.toBe('worker-b');
    expect(lockOwner).toBe('worker-b');
  });

  it('preserves the original business error when failure-state save fails', async () => {
    const record = sampleRecord({ pendingKeys: ['orphan/a.bin'], requestedCount: 1 });
    mocks.loadCleanupJob.mockResolvedValue(record);
    mocks.saveCleanupJob.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('redis write failed'));
    mocks.deleteManyObjects.mockRejectedValue(new Error('S3 timeout'));

    await expect(runAssetCleanupJob({ jobId: record.jobId, scanId: record.scanId })).rejects.toThrow('S3 timeout');
    expect(mocks.renewal.stop).toHaveBeenCalled();
    expect(mocks.releaseLock).toHaveBeenCalled();
  });

  it('does not treat a lost-lock save as an unhandled rejection', async () => {
    const record = sampleRecord({ pendingKeys: ['orphan/a.bin'], requestedCount: 1 });
    mocks.loadCleanupJob.mockResolvedValue(record);
    mocks.saveCleanupJob.mockResolvedValue(false);

    await expect(runAssetCleanupJob({ jobId: record.jobId, scanId: record.scanId })).rejects.toThrow(
      'Cleanup lock ownership lost',
    );
    expect(mocks.deleteManyObjects).not.toHaveBeenCalled();
    expect(mocks.renewal.stop).toHaveBeenCalled();
    expectOwnedSaves(mocks.acquireLock.mock.calls[0]?.[1]);
  });
});

describe('runAssetCleanupJob verification and resume', () => {
  beforeEach(() => {
    mocks.renewal.stop.mockReset();
    mocks.renewal.failed.mockReset();
    mocks.renewal.failed.mockReturnValue(false);
    mocks.acquireLock.mockReset();
    mocks.acquireLock.mockResolvedValue(true);
    mocks.releaseLock.mockReset();
    mocks.releaseLock.mockResolvedValue(undefined);
    mocks.startLockRenewal.mockReset();
    mocks.startLockRenewal.mockReturnValue(mocks.renewal);
    mocks.loadCleanupJob.mockReset();
    mocks.saveCleanupJob.mockReset();
    mocks.saveCleanupJob.mockResolvedValue(true);
    mocks.collectReferencedStorageKeys.mockReset();
    mocks.collectReferencedStorageKeys.mockResolvedValue({
      formalKeys: new Set(),
      legacyAudioSegmentKeys: new Set(),
      externalReferencedKeys: new Set(),
      allReferencedKeys: new Set(),
      kindByKey: new Map(),
    });
    mocks.deleteManyObjects.mockReset();
    mocks.deleteManyObjects.mockImplementation(async (keys: string[]) => ({ deleted: keys, failed: [] }));
    mocks.listObjects.mockReset();
    mocks.listObjects.mockResolvedValue({ objects: [], nextCursor: null, hasMore: false });
  });

  it('marks the job partial when verification still finds orphans', async () => {
    const record = sampleRecord({ pendingKeys: ['orphan/a.bin'], requestedCount: 1 });
    mocks.loadCleanupJob.mockResolvedValue(record);
    mocks.listObjects.mockResolvedValue({
      objects: [{ key: 'orphan/leftover.bin', size: 4, lastModified: null, etag: null }],
      nextCursor: null,
      hasMore: false,
    });

    await runAssetCleanupJob({ jobId: record.jobId, scanId: record.scanId });

    expect(record.status).toBe('partial');
    expect(record.verification).toMatchObject({
      ran: true,
      orphanCount: 1,
      scanComplete: true,
    });
  });

  it('does not complete when the verification scan is incomplete', async () => {
    const record = sampleRecord({ pendingKeys: [], requestedCount: 0, processedCount: 0 });
    mocks.loadCleanupJob.mockResolvedValue(record);
    mocks.listObjects.mockResolvedValue({
      objects: Array.from({ length: ASSET_SCAN_OBJECT_LIMIT }, (_, index) => ({
        key: `orphan/${index}.bin`,
        size: 1,
        lastModified: null,
        etag: null,
      })),
      nextCursor: 'more',
      hasMore: true,
    });

    await runAssetCleanupJob({ jobId: record.jobId, scanId: record.scanId });

    expect(record.verification?.scanComplete).toBe(false);
    expect(record.status).toBe('partial');
    expect(record.status).not.toBe('completed');
  });

  it('resumes remaining pendingKeys after a worker restart', async () => {
    const record = sampleRecord({
      status: 'running',
      pendingKeys: ['orphan/b.bin'],
      processedCount: 1,
      deletedCount: 1,
      deletedBytes: 10,
    });
    mocks.loadCleanupJob.mockResolvedValue(record);

    await runAssetCleanupJob({ jobId: record.jobId, scanId: record.scanId });

    expect(mocks.deleteManyObjects).toHaveBeenCalledWith(['orphan/b.bin']);
    expect(record.pendingKeys).toEqual([]);
    expect(record.processedCount).toBe(2);
    expect(record.status).toBe('completed');
  });
});
