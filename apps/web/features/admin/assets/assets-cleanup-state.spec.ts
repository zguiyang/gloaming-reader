// @vitest-environment happy-dom
import { act, createElement, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  ASSET_CLEANUP_JOB_STORAGE_KEY,
  canRetryCleanupJob,
  clearStoredCleanupJob,
  deriveAssetsPageStatus,
  getStoredCleanupJobId,
  readStoredCleanupJob,
  shouldPollCleanupJob,
  shouldRefreshScanAfterCleanupTransition,
  subscribeStoredCleanupJob,
  writeStoredCleanupJob,
} from './assets-cleanup-state';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('deriveAssetsPageStatus', () => {
  it('starts idle without a report', () => {
    expect(deriveAssetsPageStatus({ isScanning: false, hasReport: false, job: null })).toBe('idle');
  });

  it('uses scanning while a scan is in flight', () => {
    expect(deriveAssetsPageStatus({ isScanning: true, hasReport: false, job: null })).toBe('scanning');
  });

  it('maps cleanup job statuses', () => {
    expect(deriveAssetsPageStatus({ isScanning: false, hasReport: true, job: { status: 'queued' } })).toBe(
      'cleanup-queued',
    );
    expect(deriveAssetsPageStatus({ isScanning: false, hasReport: true, job: { status: 'running' } })).toBe(
      'cleanup-running',
    );
    expect(deriveAssetsPageStatus({ isScanning: false, hasReport: true, job: { status: 'partial' } })).toBe(
      'cleanup-partial',
    );
    expect(deriveAssetsPageStatus({ isScanning: false, hasReport: true, job: { status: 'completed' } })).toBe(
      'cleanup-completed',
    );
    expect(deriveAssetsPageStatus({ isScanning: false, hasReport: true, job: { status: 'failed' } })).toBe(
      'cleanup-failed',
    );
  });
});

describe('canRetryCleanupJob', () => {
  it('allows retry for partial failures and interrupted failed jobs', () => {
    expect(canRetryCleanupJob({ status: 'partial', failedCount: 1, processedCount: 10, requestedCount: 10 })).toBe(
      true,
    );
    expect(canRetryCleanupJob({ status: 'failed', failedCount: 0, processedCount: 3, requestedCount: 10 })).toBe(true);
    expect(canRetryCleanupJob({ status: 'completed', failedCount: 0, processedCount: 10, requestedCount: 10 })).toBe(
      false,
    );
    expect(canRetryCleanupJob({ status: 'running', failedCount: 0, processedCount: 3, requestedCount: 10 })).toBe(
      false,
    );
  });

  it('does not offer retry when only verification leftovers remain', () => {
    expect(
      canRetryCleanupJob({
        status: 'partial',
        failedCount: 0,
        processedCount: 10,
        requestedCount: 10,
        verification: { ran: true, orphanCount: 2, scanComplete: true },
      }),
    ).toBe(false);
    expect(
      canRetryCleanupJob({
        status: 'failed',
        failedCount: 0,
        processedCount: 10,
        requestedCount: 10,
        verification: { ran: true, orphanCount: 0, scanComplete: false },
      }),
    ).toBe(false);
  });
});

describe('shouldPollCleanupJob', () => {
  it('polls only queued and running jobs', () => {
    expect(shouldPollCleanupJob('queued')).toBe(true);
    expect(shouldPollCleanupJob('running')).toBe(true);
    expect(shouldPollCleanupJob('completed')).toBe(false);
    expect(shouldPollCleanupJob('partial')).toBe(false);
    expect(shouldPollCleanupJob('failed')).toBe(false);
    expect(shouldPollCleanupJob(undefined)).toBe(false);
  });
});

describe('shouldRefreshScanAfterCleanupTransition', () => {
  it('refreshes once when an in-flight job becomes terminal and does not loop', () => {
    expect(shouldRefreshScanAfterCleanupTransition('queued', 'completed')).toBe(true);
    expect(shouldRefreshScanAfterCleanupTransition('running', 'partial')).toBe(true);
    expect(shouldRefreshScanAfterCleanupTransition('running', 'failed')).toBe(true);
    expect(shouldRefreshScanAfterCleanupTransition('queued', 'running')).toBe(false);
    expect(shouldRefreshScanAfterCleanupTransition('completed', 'completed')).toBe(false);
    expect(shouldRefreshScanAfterCleanupTransition('partial', 'partial')).toBe(false);
    expect(shouldRefreshScanAfterCleanupTransition(undefined, 'completed')).toBe(false);
  });
});

describe('cleanup job session storage', () => {
  it('round-trips a job pointer and clears it', () => {
    sessionStorage.clear();
    writeStoredCleanupJob({ jobId: 'asset-cleanup:scan_1', scanId: 'scan_1' });
    expect(sessionStorage.getItem(ASSET_CLEANUP_JOB_STORAGE_KEY)).toContain('scan_1');
    expect(readStoredCleanupJob()).toEqual({ jobId: 'asset-cleanup:scan_1', scanId: 'scan_1' });
    clearStoredCleanupJob();
    expect(readStoredCleanupJob()).toBeNull();
  });

  it('unsubscribe prevents further notifications', () => {
    sessionStorage.clear();
    let calls = 0;
    const unsubscribe = subscribeStoredCleanupJob(() => {
      calls += 1;
    });
    writeStoredCleanupJob({ jobId: 'asset-cleanup:scan_1', scanId: 'scan_1' });
    expect(calls).toBe(1);
    unsubscribe();
    writeStoredCleanupJob({ jobId: 'asset-cleanup:scan_2', scanId: 'scan_2' });
    clearStoredCleanupJob();
    expect(calls).toBe(1);
  });

  it('stops notifying after a useSyncExternalStore consumer unmounts', async () => {
    sessionStorage.clear();
    let notifications = 0;
    const subscribe = (listener: () => void) =>
      subscribeStoredCleanupJob(() => {
        notifications += 1;
        listener();
      });

    function Probe() {
      useSyncExternalStore(subscribe, getStoredCleanupJobId, () => null);
      return null;
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Probe));
    });
    await act(async () => {
      writeStoredCleanupJob({ jobId: 'asset-cleanup:scan_1', scanId: 'scan_1' });
    });
    expect(notifications).toBeGreaterThan(0);
    const afterWrite = notifications;
    await act(async () => {
      root.unmount();
    });
    writeStoredCleanupJob({ jobId: 'asset-cleanup:scan_2', scanId: 'scan_2' });
    expect(notifications).toBe(afterWrite);
    container.remove();
  });
});
