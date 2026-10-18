// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { DiscoverySourceStatus, DiscoverySyncRunProgress } from '@gloaming/shared/discovery';

import { LocaleProvider } from '@/lib/locale-context';

import { useDiscoverySyncRunHistoryQuery } from './discovery-sources-api';
import { DiscoverySyncRunPanel } from './discovery-sync-run-panel';

const { apiRequestMock } = vi.hoisted(() => ({ apiRequestMock: vi.fn() }));
vi.mock('@/lib/api-request', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, apiRequest: apiRequestMock };
});

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const runBase = {
  id: 'run-1',
  queuedAt: '2030-01-01T00:00:00.000Z',
  startedAt: '2030-01-01T00:00:01.000Z',
  lastActivityAt: '2030-01-01T00:00:01.000Z',
  finishedAt: null,
  committedRecords: 0,
  committedBatches: 0,
  unavailableRecords: 0,
  errorSummary: null,
};

function statusWithRun(progress: DiscoverySyncRunProgress): DiscoverySourceStatus {
  const stage = progress.run?.stage;
  return {
    sourceKey: 'project_gutenberg',
    sourceType: 'gutenberg_rdf',
    enabled: true,
    syncStatus: stage === 'queued' || stage === 'processing' ? 'syncing' : 'succeeded',
    syncStartedAt: null,
    syncFinishedAt: null,
    lastSuccessAt: null,
    recordCount: 0,
    lastErrorSummary: null,
    currentRun: progress,
  } satisfies DiscoverySourceStatus;
}

/** Renders the real panel wired to the real history hook. */
function Harness({ status }: { status: DiscoverySourceStatus }) {
  const historyQuery = useDiscoverySyncRunHistoryQuery(status);
  return createElement(DiscoverySyncRunPanel, {
    progress: status.currentRun,
    history: historyQuery.data,
    historyPending: historyQuery.isPending,
  });
}

describe('useDiscoverySyncRunHistoryQuery terminal refresh', () => {
  it('refetches history once when the run turns terminal and renders the terminal entry', async () => {
    const processingRun = { ...runBase, stage: 'processing' } as const;
    const terminalRun = { ...runBase, stage: 'succeeded', finishedAt: '2030-01-01T00:02:30.000Z' } as const;

    // First history response: still-pending entry. Second (after the terminal
    // transition): the completed entry.
    apiRequestMock
      .mockResolvedValueOnce({ runs: [{ ...runBase, stage: 'processing' }] } as never)
      .mockResolvedValueOnce({ runs: [{ ...runBase, ...terminalRun }] } as never);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement('div');
    document.body.appendChild(container);

    let root!: ReturnType<typeof createRoot>;
    const render = (status: DiscoverySourceStatus) => {
      const localeProviderProps: Parameters<typeof LocaleProvider>[0] = {
        locale: 'en-US',
        children: createElement(Harness, { status }),
      };
      return createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(LocaleProvider, localeProviderProps),
      );
    };

    await act(async () => {
      root = createRoot(container);
      root.render(render(statusWithRun({ run: processingRun, consumer: 'unknown' })));
      await Promise.resolve();
    });

    // The initial history fetch happened for the pending run.
    expect(apiRequestMock).toHaveBeenCalledTimes(1);

    // The run reaches a terminal stage: the hook must force one more history
    // fetch, and the panel renders the terminal entry (not the stale pending one).
    await act(async () => {
      root.render(render(statusWithRun({ run: terminalRun, consumer: 'unknown' })));
      await Promise.resolve();
    });

    expect(apiRequestMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Succeeded');

    // Re-rendering while still terminal must not trigger another refresh.
    await act(async () => {
      root.render(render(statusWithRun({ run: terminalRun, consumer: 'unknown' })));
      await Promise.resolve();
    });

    expect(apiRequestMock).toHaveBeenCalledTimes(2);

    act(() => root.unmount());
    container.remove();
  });
});
