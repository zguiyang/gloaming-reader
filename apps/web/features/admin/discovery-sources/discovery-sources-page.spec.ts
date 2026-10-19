// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiscoverySourceStatus, DiscoverySyncRunSummary } from '@gloaming/shared/discovery';

import { LocaleProvider } from '@/lib/locale-context';

import { discoverySourcesQueryKey, discoverySyncHistoryQueryKey } from './discovery-sources-api';
import { DiscoverySourcesPage } from './discovery-sources-page';

const { apiRequestMock } = vi.hoisted(() => ({ apiRequestMock: vi.fn() }));
vi.mock('@/lib/api-request', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, apiRequest: apiRequestMock };
});
// Toasts fire from the sync handlers; wording under test is page copy.
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

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

function statusFixture(overrides: Partial<DiscoverySourceStatus> = {}): DiscoverySourceStatus {
  return {
    sourceKey: 'project_gutenberg',
    sourceType: 'gutenberg_rdf',
    enabled: true,
    syncStatus: 'idle',
    syncStartedAt: null,
    syncFinishedAt: null,
    lastSuccessAt: null,
    recordCount: 1,
    lastErrorSummary: null,
    currentRun: { run: null, consumer: 'unknown' },
    ...overrides,
  };
}

async function renderPage(status: DiscoverySourceStatus, locale: 'en-US' | 'zh-CN' = 'en-US') {
  // Seeded data must not be refetched (no network in this wording test).
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation((url: string) =>
    url.endsWith('/sync/runs') ? Promise.resolve({ runs: [] }) : Promise.resolve(status),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  // Pure wording test: seed both queries so the page renders immediately;
  // network timing is out of scope here.
  queryClient.setQueryData(discoverySourcesQueryKey, status);
  queryClient.setQueryData(discoverySyncHistoryQueryKey, { runs: [] });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const localeProviderProps: Parameters<typeof LocaleProvider>[0] = {
    locale,
    children: createElement(DiscoverySourcesPage),
  };
  let root!: ReturnType<typeof createRoot>;
  await act(async () => {
    root = createRoot(container);
    root.render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(LocaleProvider, localeProviderProps)),
    );
    await Promise.resolve();
  });
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
      queryClient.clear();
    },
  };
}

describe('DiscoverySourcesPage pending wording', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it('shows queued wording (not syncing) while the source is queued', async () => {
    const rendered = await renderPage(statusFixture({ syncStatus: 'queued' }));
    expect(rendered.container.textContent).toContain('Queued…');
    expect(rendered.container.textContent).toContain('The task is queued and waiting to be processed.');
    expect(rendered.container.textContent).not.toContain('Syncing…');
    expect(rendered.container.textContent).not.toContain('A sync is already running in the background.');
    rendered.cleanup();
  });

  it('keeps syncing wording while the source is syncing', async () => {
    const rendered = await renderPage(statusFixture({ syncStatus: 'syncing' }));
    expect(rendered.container.textContent).toContain('Syncing…');
    expect(rendered.container.textContent).toContain('A sync is already running in the background.');
    rendered.cleanup();
  });

  it('renders the zh-CN queued wording', async () => {
    const rendered = await renderPage(statusFixture({ syncStatus: 'queued' }), 'zh-CN');
    expect(rendered.container.textContent).toContain('排队中…');
    expect(rendered.container.textContent).toContain('任务已排队，等待处理。');
    rendered.cleanup();
  });

  it('leaves the idle wording unchanged', async () => {
    const idle = await renderPage(statusFixture({ syncStatus: 'idle' }));
    expect(idle.container.textContent).toContain('Sync now');
    expect(idle.container.textContent).not.toContain('Queued…');
    idle.cleanup();
  });
});

describe('DiscoverySourcesPage force full refresh', () => {
  function findButton(label: string): HTMLButtonElement | undefined {
    return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === label,
    );
  }

  async function click(button: HTMLButtonElement | undefined) {
    expect(button).toBeDefined();
    await act(async () => {
      button!.click();
      // Flush the mutation's promise chain (react-query) and the re-render.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it('offers a secondary force action behind a confirmation that explains the full reparse', async () => {
    const rendered = await renderPage(statusFixture());
    // The original trigger is preserved next to the new secondary action.
    expect(findButton('Sync now')).toBeDefined();

    await click(findButton('Force full refresh'));
    // The confirmation is portaled to the document body.
    const dialogText = document.body.textContent ?? '';
    expect(dialogText).toContain('Force a full refresh?');
    expect(dialogText).toContain('re-downloads and re-parses the complete Gutenberg snapshot');
    expect(dialogText).toContain('may take several minutes');
    rendered.cleanup();
  });

  it('renders the zh-CN force refresh wording from i18n', async () => {
    const rendered = await renderPage(statusFixture(), 'zh-CN');

    await click(findButton('强制全量刷新'));
    const dialogText = document.body.textContent ?? '';
    expect(dialogText).toContain('要强制全量刷新吗？');
    expect(dialogText).toContain('会重新下载并解析完整的 Gutenberg 快照，可能需要数分钟。');
    expect(dialogText).toContain('开始全量刷新');
    rendered.cleanup();
  });

  it('posts {force:true} only after the confirmation is accepted', async () => {
    const rendered = await renderPage(statusFixture());
    apiRequestMock.mockClear();

    await click(findButton('Force full refresh'));
    await click(findButton('Start full refresh'));

    const syncCall = apiRequestMock.mock.calls.find(
      ([url, options]) => String(url).endsWith('/sync') && (options as { method?: string })?.method === 'POST',
    );
    expect(syncCall).toBeDefined();
    expect(syncCall![1]).toMatchObject({ method: 'POST', json: { force: true } });
    rendered.cleanup();
  });

  it('keeps the original sync trigger body-less', async () => {
    const rendered = await renderPage(statusFixture());
    apiRequestMock.mockClear();

    await click(findButton('Sync now'));

    const syncCall = apiRequestMock.mock.calls.find(
      ([url, options]) => String(url).endsWith('/sync') && (options as { method?: string })?.method === 'POST',
    );
    expect(syncCall).toBeDefined();
    expect(syncCall![1]).not.toHaveProperty('json');
    rendered.cleanup();
  });
});

describe('DiscoverySourcesPage missing-run explanation', () => {
  const untrackedRun = { ...runBase, stage: 'processing' } as unknown as DiscoverySyncRunSummary;

  it('explains the missing run detail while queued without asserting failure', async () => {
    const rendered = await renderPage(
      statusFixture({ syncStatus: 'queued', currentRun: { run: null, consumer: 'unknown' } }),
    );
    expect(rendered.container.textContent).toContain(
      'This task has no detailed run record; tasks created earlier may have no history.',
    );
    expect(rendered.container.textContent).toContain('New tasks will record their stage and outcome.');
    rendered.cleanup();
  });

  it('explains the missing run detail while syncing', async () => {
    const rendered = await renderPage(
      statusFixture({ syncStatus: 'syncing', currentRun: { run: null, consumer: 'unavailable' } }),
    );
    expect(rendered.container.textContent).toContain('This task has no detailed run record');
    rendered.cleanup();
  });

  it('shows no missing-run hint for an idle source without a run', async () => {
    const rendered = await renderPage(
      statusFixture({ syncStatus: 'idle', currentRun: { run: null, consumer: 'unknown' } }),
    );
    expect(rendered.container.textContent).not.toContain('This task has no detailed run record');
    rendered.cleanup();
  });

  it('shows no missing-run hint when a tracked run exists', async () => {
    const rendered = await renderPage(
      statusFixture({ syncStatus: 'queued', currentRun: { run: untrackedRun, consumer: 'unknown' } }),
    );
    expect(rendered.container.textContent).not.toContain('This task has no detailed run record');
    rendered.cleanup();
  });
});
