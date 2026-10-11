// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SourceRecordItem, SourceRecordListData } from '@gloaming/shared/discovery';
import type { CatalogListData } from '@gloaming/shared/works';

import { LocaleProvider } from '@/lib/locale-context';

import { DiscoverPage } from './discover-page';

const mocks = vi.hoisted(() => ({
  fetchDiscoverRecords: vi.fn(),
  fetchDiscoverLegacyWorks: vi.fn(),
  useDiscoverCategoriesQuery: vi.fn(),
  saveSourceRecordToLibrary: vi.fn(),
  formatDiscoverApiError: vi.fn((error: unknown) => String(error)),
  openLogin: vi.fn(),
  toastInfo: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@/features/discover/discover-api', () => ({
  discoverQueryKey: {
    all: ['discover'],
    records: (params: unknown) => ['discover', 'records', params],
    categories: () => ['discover', 'categories'],
    legacyWorks: (params: unknown) => ['discover', 'legacy-works', params],
  },
  fetchDiscoverRecords: mocks.fetchDiscoverRecords,
  fetchDiscoverLegacyWorks: mocks.fetchDiscoverLegacyWorks,
  useDiscoverCategoriesQuery: mocks.useDiscoverCategoriesQuery,
  saveSourceRecordToLibrary: mocks.saveSourceRecordToLibrary,
  formatDiscoverApiError: mocks.formatDiscoverApiError,
}));

vi.mock('@/features/auth', () => ({ useAuthDialog: () => ({ openLogin: mocks.openLogin }) }));
vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError, info: mocks.toastInfo },
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const pagination = {
  page: 1,
  pageSize: 15,
  total: 1,
  totalPages: 1,
  sortBy: 'sourceUpdatedAt',
  sortOrder: 'desc' as const,
};

function record(overrides: Partial<SourceRecordItem> = {}): SourceRecordItem {
  return {
    sourceRecordId: 'sr-1',
    linkedWorkId: null,
    sourceId: 'source-1',
    sourceKey: 'gutenberg',
    sourceType: 'gutenberg',
    externalId: '1342',
    title: 'Pride and Prejudice',
    authors: [{ name: 'Jane Austen' }],
    languages: ['en'],
    description: null,
    coverUrl: null,
    availability: 'available',
    sourceUpdatedAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    categories: [{ id: 'cat-1', name: '科幻' }],
    ...overrides,
  };
}

function recordsData(items: SourceRecordItem[]): SourceRecordListData {
  return { items, pagination: { ...pagination, total: items.length, totalPages: items.length > 0 ? 1 : 0 } };
}

function legacyData(): CatalogListData {
  return {
    items: [
      {
        id: 'work-1',
        title: 'Legacy Published',
        author: 'Legacy Author',
        description: '',
        language: 'en',
        processingStatus: 'ready',
        visibility: 'catalog',
        coverAssetId: null,
        wordCount: null,
        estimatedMinutes: null,
        suggestedVocabSize: null,
        difficultyScore: null,
        statsProvenance: null,
        publishedAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        partCount: 4,
      },
    ],
    pagination: { ...pagination, sortBy: 'publishedAt' },
  };
}

function withProviders(node: ReactElement, client: QueryClient, locale: 'zh-CN' | 'en-US') {
  return createElement(
    QueryClientProvider,
    { client },
    // eslint-disable-next-line react/no-children-prop
    createElement(LocaleProvider, { locale, children: node }),
  );
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderDiscover(locale: 'zh-CN' | 'en-US' = 'zh-CN') {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const render = async () => {
    await act(async () => {
      root.render(withProviders(createElement(DiscoverPage), client, locale));
    });
    await flush();
  };
  await render();
  return {
    container,
    render,
    cleanup() {
      void act(() => root.unmount());
      container.remove();
    },
  };
}

function buttonByText(container: ParentNode, text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent === text);
}

function updateInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function lastRecordParams() {
  const calls = mocks.fetchDiscoverRecords.mock.calls;
  return calls.at(-1)?.[0] as { page: number; q?: string; categoryId?: string } | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useDiscoverCategoriesQuery.mockReturnValue({
    data: {
      items: [
        { id: 'cat-1', name: '科幻', recordCount: 2 },
        { id: 'cat-2', name: '历史', recordCount: 1 },
      ],
    },
    isLoading: false,
  });
  mocks.fetchDiscoverRecords.mockResolvedValue(recordsData([record()]));
  mocks.fetchDiscoverLegacyWorks.mockResolvedValue(legacyData());
});

describe('DiscoverPage', () => {
  it('browses localized categories and filters the SourceRecord list by the selection', async () => {
    const view = await renderDiscover();
    expect(view.container.textContent).toContain('发现');
    expect(view.container.textContent).toContain('科幻');
    expect(view.container.textContent).toContain('历史');

    await act(async () => {
      buttonByText(view.container, '科幻')?.click();
    });
    await flush();

    expect(lastRecordParams()).toMatchObject({ page: 1, categoryId: 'cat-1' });
    expect(view.container.textContent).toContain('当前筛选');
    // Legacy works carry no category identity and drop out of the filtered view.
    expect(view.container.textContent).not.toContain('已发布书目');
    view.cleanup();
  });

  it('applies explicit search on submit and resets to the first page', async () => {
    const view = await renderDiscover();

    await act(async () => {
      buttonByText(view.container, '历史')?.click();
    });
    await flush();

    const input = view.container.querySelector<HTMLInputElement>('#discover-search');
    expect(input).toBeTruthy();
    await act(async () => {
      updateInput(input!, 'austen');
    });
    await act(async () => {
      buttonByText(view.container, '搜索')?.click();
    });
    await flush();

    expect(lastRecordParams()).toMatchObject({ page: 1, q: 'austen', categoryId: 'cat-2' });
    view.cleanup();
  });

  it('clears the search and category filters from the empty state', async () => {
    mocks.fetchDiscoverRecords.mockResolvedValue(recordsData([]));
    mocks.fetchDiscoverLegacyWorks.mockResolvedValue({ items: [], pagination });
    const view = await renderDiscover();

    await act(async () => {
      buttonByText(view.container, '科幻')?.click();
    });
    await flush();
    expect(view.container.textContent).toContain('没有符合条件的内容');

    await act(async () => {
      buttonByText(view.container, '清除筛选')?.click();
    });
    await flush();

    expect(lastRecordParams()).toMatchObject({ page: 1 });
    expect(lastRecordParams()?.categoryId).toBeUndefined();
    view.cleanup();
  });

  it('shows the localized empty state without an active filter', async () => {
    mocks.fetchDiscoverRecords.mockResolvedValue(recordsData([]));
    mocks.fetchDiscoverLegacyWorks.mockResolvedValue({ items: [], pagination });
    const view = await renderDiscover('en-US');

    expect(view.container.textContent).toContain('Nothing to discover yet');
    view.cleanup();
  });

  it('keeps already-published Catalog Works visible through the unlinked compatibility path', async () => {
    mocks.fetchDiscoverRecords.mockResolvedValue(recordsData([]));
    const view = await renderDiscover();
    await flush();

    expect(mocks.fetchDiscoverLegacyWorks).toHaveBeenCalled();
    expect(view.container.textContent).toContain('已发布书目');
    expect(view.container.textContent).toContain('Legacy Published');
    expect(view.container.querySelector('a[href^="/works/work-1"]')).toBeTruthy();
    view.cleanup();
  });

  it('renders unlinked legacy Works alongside SourceRecords when no category is selected', async () => {
    mocks.fetchDiscoverRecords.mockResolvedValue(recordsData([record()]));
    const view = await renderDiscover();
    await flush();

    expect(view.container.textContent).toContain('Pride and Prejudice');
    expect(view.container.textContent).toContain('加入书库');
    expect(view.container.textContent).toContain('已发布书目');
    expect(view.container.textContent).toContain('Legacy Published');
    expect(view.container.querySelector('a[href^="/works/work-1"]')).toBeTruthy();
    view.cleanup();
  });

  it('links a materialized SourceRecord to its existing Work detail entry', async () => {
    mocks.fetchDiscoverRecords.mockResolvedValue(
      recordsData([record({ sourceRecordId: 'sr-linked', linkedWorkId: 'work-77' })]),
    );
    const view = await renderDiscover();

    expect(view.container.querySelector('a[href^="/works/work-77"]')).toBeTruthy();
    expect(view.container.textContent).toContain('查看详情');
    expect(view.container.textContent).not.toContain('加入书库');
    view.cleanup();
  });
});
