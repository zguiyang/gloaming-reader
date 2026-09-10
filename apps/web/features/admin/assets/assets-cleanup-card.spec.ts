// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it } from 'vitest';

import type { AssetCleanupJob } from '@gloaming/shared/assets';

import { AssetsCleanupCard, cleanupProgressPercent } from './assets-cleanup-card';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function sampleFailures(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    key: `orphan/${index}.bin`,
    error: `error-${index}`,
  }));
}

function sampleJob(overrides: Partial<AssetCleanupJob> = {}): AssetCleanupJob {
  return {
    jobId: 'asset-cleanup:scan_1',
    scanId: 'scan_1',
    status: 'running',
    requestedCount: 10,
    processedCount: 4,
    deletedCount: 3,
    skippedReferencedCount: 1,
    failedCount: 0,
    deletedBytes: 1024,
    failedSample: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
    ...overrides,
  };
}

async function renderCard(job: AssetCleanupJob, extra: { onRetry?: () => void; retrying?: boolean } = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(AssetsCleanupCard, { job, ...extra }));
  });
  return {
    container,
    root,
    async rerender(nextJob: AssetCleanupJob, nextExtra: { onRetry?: () => void; retrying?: boolean } = extra) {
      await act(async () => {
        root.render(createElement(AssetsCleanupCard, { job: nextJob, ...nextExtra }));
      });
    },
    cleanup() {
      void act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe('cleanupProgressPercent', () => {
  it('caps at 100 and treats an empty request as complete', () => {
    expect(cleanupProgressPercent({ processedCount: 0, requestedCount: 0 })).toBe(100);
    expect(cleanupProgressPercent({ processedCount: 4, requestedCount: 10 })).toBe(40);
    expect(cleanupProgressPercent({ processedCount: 15, requestedCount: 10 })).toBe(100);
  });
});

describe('AssetsCleanupCard', () => {
  it('renders queued then running then completed without a retry action', async () => {
    const view = await renderCard(sampleJob({ status: 'queued', processedCount: 0 }));
    expect(view.container.textContent).toContain('排队中');
    expect(view.container.textContent).toContain('任务在后台执行，可继续浏览本页。');
    expect(view.container.textContent).not.toContain('重试失败对象');

    await view.rerender(sampleJob({ status: 'running', processedCount: 4 }));
    expect(view.container.textContent).toContain('清理中');
    expect(view.container.textContent).toContain('任务在后台执行，可继续浏览本页。');

    await view.rerender(sampleJob({ status: 'completed', processedCount: 10, requestedCount: 10 }));
    expect(view.container.textContent).toContain('已完成');
    expect(view.container.textContent).not.toContain('任务在后台执行，可继续浏览本页。');
    expect(view.container.textContent).not.toContain('重试失败对象');
    view.cleanup();
  });

  it('renders leftover-orphan copy when a running job becomes partial', async () => {
    const view = await renderCard(sampleJob({ status: 'running', processedCount: 4 }));
    expect(view.container.textContent).toContain('清理中');
    await view.rerender(
      sampleJob({
        status: 'partial',
        processedCount: 10,
        requestedCount: 10,
        verification: { ran: true, orphanCount: 3, missingCount: 0, scanComplete: true, scanId: 'scan_2' },
      }),
      { onRetry: () => undefined },
    );
    expect(view.container.textContent).toContain('部分失败');
    expect(view.container.textContent).toContain('任务执行结束，但仍有未清理对象');
    expect(view.container.textContent).toContain('清理后仍有孤儿 3');
    expect(view.container.textContent).not.toContain('重试失败对象');
    view.cleanup();
  });

  it('renders leftover-orphan copy when a partial verification scan is incomplete', async () => {
    const view = await renderCard(
      sampleJob({
        status: 'partial',
        processedCount: 10,
        requestedCount: 10,
        verification: { ran: true, orphanCount: 0, missingCount: 0, scanComplete: false, scanId: 'scan_2' },
      }),
    );
    expect(view.container.textContent).toContain('任务执行结束，但仍有未清理对象');
    view.cleanup();
  });

  it('offers retry for a failed job and only invokes onRetry', async () => {
    let retryCalls = 0;
    const view = await renderCard(
      sampleJob({
        status: 'failed',
        failedCount: 1,
        failedSample: [{ key: 'orphan/a.mp3', error: 'AccessDenied' }],
      }),
      {
        onRetry: () => {
          retryCalls += 1;
        },
      },
    );
    expect(view.container.textContent).toContain('失败');
    expect(view.container.textContent).toContain('重试失败对象');
    expect(view.container.textContent).toContain('AccessDenied');
    const button = view.container.querySelector('button');
    expect(button).not.toBeNull();
    await act(async () => {
      button?.click();
    });
    expect(retryCalls).toBe(1);
    view.cleanup();
  });

  it('renders only the failure sample plus leftover count for a large list', async () => {
    const view = await renderCard(
      sampleJob({
        status: 'partial',
        failedCount: 500,
        failedSample: sampleFailures(50),
      }),
      { onRetry: () => undefined },
    );
    expect(view.container.querySelectorAll('li')).toHaveLength(50);
    expect(view.container.textContent).toContain('error-0');
    expect(view.container.textContent).toContain('error-49');
    expect(view.container.textContent).not.toContain('error-50');
    expect(view.container.textContent).toContain('还有 450 个失败对象未展开');
    view.cleanup();
  });

  it('caps the progress bar at 100% when processedCount exceeds requestedCount', async () => {
    const view = await renderCard(sampleJob({ processedCount: 15, requestedCount: 10 }));
    expect(view.container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('100');
    view.cleanup();
  });

  it('renders partial progress and a retry action', async () => {
    const view = await renderCard(
      sampleJob({
        status: 'partial',
        failedCount: 1,
        failedSample: [{ key: 'orphan/a.mp3', error: 'AccessDenied' }],
      }),
      { onRetry: () => undefined },
    );
    expect(view.container.textContent).toContain('部分失败');
    expect(view.container.textContent).toContain('重试失败对象');
    expect(view.container.textContent).toContain('AccessDenied');
    view.cleanup();
  });

  it('does not offer retry while the job is running', async () => {
    const view = await renderCard(sampleJob({ status: 'running' }));
    expect(view.container.textContent).toContain('清理中');
    expect(view.container.textContent).not.toContain('重试失败对象');
    view.cleanup();
  });
});
