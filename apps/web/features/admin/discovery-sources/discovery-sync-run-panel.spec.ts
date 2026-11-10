// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  DiscoverySyncConsumerState,
  DiscoverySyncRunHistory,
  DiscoverySyncRunProgress,
  DiscoverySyncRunStage,
} from '@gloaming/shared/discovery';

import { LocaleProvider } from '@/lib/locale-context';

import { DiscoverySyncRunPanel } from './discovery-sync-run-panel';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

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

function progress(stage: DiscoverySyncRunStage, consumer: DiscoverySyncConsumerState = 'unknown') {
  return { run: { ...runBase, stage }, consumer } satisfies DiscoverySyncRunProgress;
}

async function renderPanel(props: {
  progress: DiscoverySyncRunProgress;
  history?: DiscoverySyncRunHistory;
  historyPending?: boolean;
  historyError?: boolean;
  onRetryHistory?: () => void;
  locale?: 'en-US' | 'zh-CN';
}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root!: ReturnType<typeof createRoot>;
  const localeProviderProps: Parameters<typeof LocaleProvider>[0] = {
    locale: props.locale ?? 'en-US',
    children: createElement(DiscoverySyncRunPanel, {
      progress: props.progress,
      history: props.history,
      historyPending: props.historyPending ?? false,
      historyError: props.historyError,
      onRetryHistory: props.onRetryHistory,
    }),
  };
  await act(async () => {
    root = createRoot(container);
    root.render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(LocaleProvider, localeProviderProps)),
    );
  });
  await flush();
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('DiscoverySyncRunPanel', () => {
  it('distinguishes waiting-for-consumer, worker-available, and unknown for a queued run', async () => {
    const waiting = await renderPanel({ progress: progress('queued', 'unavailable') });
    expect(waiting.container.textContent).toContain('Waiting for a queue worker.');
    waiting.cleanup();

    const available = await renderPanel({ progress: progress('queued', 'available') });
    expect(available.container.textContent).toContain('A queue worker is available.');
    available.cleanup();

    const unknown = await renderPanel({ progress: progress('queued', 'unknown') });
    expect(unknown.container.textContent).toContain('Worker availability unknown.');
    unknown.cleanup();
  });

  it('never claims a percentage or an unknown total while processing', async () => {
    const processing = await renderPanel({
      progress: {
        run: { ...runBase, stage: 'processing', committedRecords: 500, committedBatches: 1 },
        consumer: 'unknown',
      },
    });
    expect(processing.container.textContent).toContain('500 records committed');
    expect(processing.container.textContent).toContain('1 batches committed');
    expect(processing.container.textContent).not.toMatch(/%|percent/i);
    processing.cleanup();
  });

  it('shows recent runs with truthful terminal stages and sanitized errors', async () => {
    const history: DiscoverySyncRunHistory = {
      runs: [
        {
          ...runBase,
          id: 'run-failed',
          stage: 'failed',
          committedRecords: 500,
          committedBatches: 1,
          finishedAt: '2030-01-01T00:10:00.000Z',
          errorSummary: 'the snapshot download failed with HTTP status 503',
        },
        {
          ...runBase,
          id: 'run-ok',
          stage: 'not_modified',
          startedAt: '2030-01-01T00:20:01.000Z',
          finishedAt: '2030-01-01T00:20:02.000Z',
        },
      ],
    };
    const rendered = await renderPanel({
      progress: { run: null, consumer: 'unknown' },
      history,
    });
    expect(rendered.container.textContent).toContain('Failed');
    expect(rendered.container.textContent).toContain('the snapshot download failed with HTTP status 503');
    // A 304 no-op run is labeled truthfully, not as a full scan.
    expect(rendered.container.textContent).toContain('Not modified');
    rendered.cleanup();
  });

  it('renders the zh-CN strings for consumer and stage wording', async () => {
    const zh = await renderPanel({ progress: progress('queued', 'unavailable'), locale: 'zh-CN' });
    expect(zh.container.textContent).toContain('等待队列工作进程。');
    expect(zh.container.textContent).toContain('排队中');
    zh.cleanup();
  });

  it('freezes the elapsed time of a finished run instead of letting it grow', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2030-01-01T01:00:00.000Z'));
      const finished = await renderPanel({
        progress: {
          run: {
            ...runBase,
            stage: 'succeeded',
            startedAt: '2030-01-01T00:00:00.000Z',
            lastActivityAt: '2030-01-01T00:02:00.000Z',
            finishedAt: '2030-01-01T00:02:30.000Z',
          },
          consumer: 'unknown',
        },
      });
      // Frozen at finishedAt - startedAt = 2m 30s, not the 1h wall clock.
      expect(finished.container.textContent).toContain('2m 30s');
      finished.cleanup();

      const running = await renderPanel({
        progress: {
          run: {
            ...runBase,
            stage: 'processing',
            startedAt: '2030-01-01T00:59:00.000Z',
            finishedAt: null,
          },
          consumer: 'unknown',
        },
      });
      // In progress: still grows with now (1m at the fake system time).
      expect(running.container.textContent).toContain('1m 00s');
      running.cleanup();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows last activity and finish timestamps for a completed run', async () => {
    const rendered = await renderPanel({
      progress: {
        run: {
          ...runBase,
          stage: 'succeeded',
          lastActivityAt: '2030-01-01T00:02:00.000Z',
          finishedAt: '2030-01-01T00:02:30.000Z',
        },
        consumer: 'unknown',
      },
    });
    expect(rendered.container.textContent).toContain('Last activity');
    expect(rendered.container.textContent).toContain('Finished');
    rendered.cleanup();
  });

  it('renders a history load error with a retry instead of an empty history', async () => {
    let hasRetried = false;
    const rendered = await renderPanel({
      progress: { run: null, consumer: 'unknown' },
      historyError: true,
      onRetryHistory: () => {
        hasRetried = true;
      },
    });
    // A failed history fetch is an explicit error, never rendered as "no runs".
    expect(rendered.container.textContent).toContain('Could not load recent runs');
    expect(rendered.container.textContent).not.toContain('No recent runs.');
    const retry = rendered.container.querySelector('[data-testid="history-retry"]') as HTMLButtonElement | null;
    expect(retry).not.toBeNull();
    await act(async () => {
      retry!.click();
    });
    expect(hasRetried).toBe(true);
    rendered.cleanup();
  });
});
