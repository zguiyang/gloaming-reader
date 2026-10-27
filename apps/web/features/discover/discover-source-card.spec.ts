// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '@/lib/api-request';
import { LocaleProvider } from '@/lib/locale-context';

import type { DiscoverItem } from './discover-model';
import { DiscoverSourceCard } from './discover-source-card';

const mocks = vi.hoisted(() => ({
  saveSourceRecordToLibrary: vi.fn(),
  useSourceRecordSaveStatusQuery: vi.fn(),
  openLogin: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  userId: 'user-1' as string | null,
  toastInfo: vi.fn(),
}));

vi.mock('@/features/discover/discover-api', () => ({
  discoverQueryKey: {
    all: ['discover'] as const,
    records: (params: unknown) => ['discover', 'records', params],
    saveStatus: (sourceRecordId: string, userId: string | null) => ['discover', 'save-status', userId, sourceRecordId],
  },
  saveSourceRecordToLibrary: mocks.saveSourceRecordToLibrary,
  useSourceRecordSaveStatusQuery: mocks.useSourceRecordSaveStatusQuery,
}));

vi.mock('@/features/auth', () => ({ useAuthDialog: () => ({ openLogin: mocks.openLogin }) }));
vi.mock('@/lib/auth', () => ({
  authClient: { useSession: () => ({ data: mocks.userId ? { user: { id: mocks.userId } } : null }) },
}));
vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError, info: mocks.toastInfo },
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const item: DiscoverItem = {
  id: 'sr-1',
  linkedWorkId: null,
  detailAvailable: false,
  title: 'Pride and Prejudice',
  author: 'Jane Austen',
  coverImageUrl: null,
  categories: [{ id: 'cat-1', name: '科幻' }],
  isSaveable: true,
};

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderCard(locale: 'zh-CN' | 'en-US' = 'zh-CN', cardItem: DiscoverItem = item) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  const render = () =>
    act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          // eslint-disable-next-line react/no-children-prop
          createElement(LocaleProvider, { locale, children: createElement(DiscoverSourceCard, { item: cardItem }) }),
        ),
      );
    });
  await render();
  return {
    container,
    client,
    invalidateSpy,
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userId = 'user-1';
  mocks.useSourceRecordSaveStatusQuery.mockReturnValue({ data: undefined });
});

describe('DiscoverSourceCard Save Intent', () => {
  it('keeps an in-flight POST result scoped to its initiating user after a session switch', async () => {
    let resolveSave!: (result: { status: 'pending'; workId: string | null }) => void;
    mocks.saveSourceRecordToLibrary.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    const view = await renderCard();
    await act(async () => {
      buttonByText(view.container, '加入书库')?.click();
    });
    mocks.userId = 'user-2';
    await view.render();
    await act(async () => {
      resolveSave({ status: 'pending', workId: 'work-1' });
    });
    expect(view.container.textContent).not.toContain('正在准备…');
    expect(view.client.getQueryData(['discover', 'save-status', 'user-1', 'sr-1'])).toMatchObject({
      status: 'pending',
    });
    expect(view.client.getQueryData(['discover', 'save-status', 'user-2', 'sr-1'])).toBeUndefined();
    view.cleanup();
  });

  it('creates a pending Save Intent on explicit click and never auto-saves', async () => {
    mocks.saveSourceRecordToLibrary.mockResolvedValue({ status: 'pending', workId: null });
    const view = await renderCard();

    expect(mocks.saveSourceRecordToLibrary).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain('加入书库');

    let resolveOldRead!: (value: { status: 'none'; workId: null; failureReason: null }) => void;
    const oldRead = view.client
      .fetchQuery({
        queryKey: ['discover', 'save-status', 'user-1', 'sr-1'],
        queryFn: () =>
          new Promise((resolve) => {
            resolveOldRead = resolve;
          }),
      })
      .catch(() => undefined);

    await act(async () => {
      buttonByText(view.container, '加入书库')?.click();
    });
    await flush();
    resolveOldRead({ status: 'none', workId: null, failureReason: null });
    await oldRead;

    expect(mocks.saveSourceRecordToLibrary).toHaveBeenCalledWith('sr-1');
    expect(view.container.textContent).toContain('正在准备…');
    expect(view.container.textContent).toContain('下载与解析完成后会出现在书库');
    // The POST result seeds the status cache so polling and refresh recovery
    // start from the server-reported state.
    expect(view.client.getQueryData(['discover', 'save-status', 'user-1', 'sr-1'])).toEqual({
      status: 'pending',
      workId: null,
      failureReason: null,
    });
    expect(view.invalidateSpy).toHaveBeenCalled();
    view.cleanup();
  });

  it('shows completed Library membership with an explicit link when the Work is ready', async () => {
    mocks.saveSourceRecordToLibrary.mockResolvedValue({ status: 'ready', workId: 'work-1' });
    const view = await renderCard();

    await act(async () => {
      buttonByText(view.container, '加入书库')?.click();
    });
    await flush();

    expect(view.container.textContent).toContain('已在书库');
    expect(view.container.querySelector('a[href="/library"]')).toBeTruthy();
    view.cleanup();
  });

  it('opens the login dialog and stays idle on an unauthenticated Save Intent', async () => {
    mocks.saveSourceRecordToLibrary.mockRejectedValue(new ApiRequestError({ message: '未登录', status: 401 }));
    const view = await renderCard();

    await act(async () => {
      buttonByText(view.container, '加入书库')?.click();
    });
    await flush();

    expect(mocks.openLogin).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain('加入书库');
    view.cleanup();
  });

  it('reports a failed Save Intent and lets the user retry', async () => {
    mocks.saveSourceRecordToLibrary.mockRejectedValue(new Error('network'));
    const view = await renderCard();

    await act(async () => {
      buttonByText(view.container, '加入书库')?.click();
    });
    await flush();

    expect(mocks.toastError).toHaveBeenCalledWith('加入书库失败，请重试');
    expect(view.container.textContent).toContain('加入书库');
    view.cleanup();
  });

  it('shows the server-provided explanation when the source record has no EPUB candidate', async () => {
    // 409 rejection: the server explains why the record cannot be saved.
    mocks.saveSourceRecordToLibrary.mockRejectedValue(
      new ApiRequestError({
        message: '该来源暂无可读 EPUB，暂时无法加入书库',
        status: 409,
        code: 'api.errors.library.sourceRecordNoEpubCandidate',
      }),
    );
    const view = await renderCard();

    await act(async () => {
      buttonByText(view.container, '加入书库')?.click();
    });
    await flush();

    expect(mocks.toastError).toHaveBeenCalledWith('该来源暂无可读 EPUB，暂时无法加入书库');
    expect(mocks.toastError).not.toHaveBeenCalledWith('加入书库失败，请重试');
    // It is a rejection, not an authentication problem.
    expect(mocks.openLogin).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain('加入书库');
    view.cleanup();
  });

  it('keeps the generic failure copy for other API error codes', async () => {
    mocks.saveSourceRecordToLibrary.mockRejectedValue(
      new ApiRequestError({ message: '服务暂时不可用', status: 503, code: 'api.errors.common.internal' }),
    );
    const view = await renderCard();

    await act(async () => {
      buttonByText(view.container, '加入书库')?.click();
    });
    await flush();

    expect(mocks.toastError).toHaveBeenCalledWith('加入书库失败，请重试');
    expect(mocks.openLogin).not.toHaveBeenCalled();
    view.cleanup();
  });

  it('renders localized category chips without a Work-detail link', async () => {
    const view = await renderCard();
    expect(view.container.textContent).toContain('科幻');
    expect(view.container.querySelector('a')).toBeNull();
    view.cleanup();
  });

  it('disables saving and explains when no readable EPUB is available yet', async () => {
    const view = await renderCard('zh-CN', { ...item, isSaveable: false });

    const button = buttonByText(view.container, '加入书库');
    expect(button).toBeTruthy();
    expect(button!.disabled).toBe(true);
    expect(view.container.textContent).toContain('暂无可读 EPUB，暂时无法加入书库。');

    await act(async () => {
      button!.click();
    });
    await flush();

    // The disabled action must never create a Save Intent or seed its cache.
    expect(mocks.saveSourceRecordToLibrary).not.toHaveBeenCalled();
    expect(view.client.getQueryData(['discover', 'save-status', 'user-1', 'sr-1'])).toBeUndefined();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain('暂无可读 EPUB，暂时无法加入书库。');
    view.cleanup();
  });

  it('keeps the existing Work-detail entry for a materialized SourceRecord the server opened', async () => {
    const view = await renderCard('zh-CN', { ...item, linkedWorkId: 'work-77', detailAvailable: true });

    expect(view.container.querySelector('a[href^="/works/work-77"]')).toBeTruthy();
    // Both the cover and the title carry the detail link.
    expect(view.container.querySelector('h3 a[href^="/works/work-77"]')).toBeTruthy();
    expect(view.container.textContent).toContain('查看详情');
    expect(view.container.textContent).not.toContain('加入书库');
    expect(mocks.saveSourceRecordToLibrary).not.toHaveBeenCalled();
    view.cleanup();
  });

  it('never exposes a detail link when the server reports the Work unreadable', async () => {
    const view = await renderCard('zh-CN', { ...item, linkedWorkId: 'work-77', detailAvailable: false });

    // A linked Work the viewer may not open must not produce any detail entry:
    // neither the cover nor the title becomes a link (they would 404).
    expect(view.container.querySelector('a[href^="/works/work-77"]')).toBeNull();
    expect(view.container.querySelector('h3 a')).toBeNull();
    expect(view.container.querySelector('a')).toBeNull();
    expect(view.container.textContent).not.toContain('查看详情');
    // The record keeps its normal save affordance instead.
    expect(view.container.textContent).toContain('加入书库');
    view.cleanup();
  });

  it('recovers pending state from the server even when a Work is already linked', async () => {
    // Materialization links the Work first and keeps parsing: linkedWorkId must
    // not claim completion or expose a premature detail entry, even when the
    // list projection already marks an eventual entry available.
    mocks.useSourceRecordSaveStatusQuery.mockReturnValue({
      data: { status: 'pending', workId: 'work-9', failureReason: null },
    });
    const view = await renderCard('zh-CN', { ...item, linkedWorkId: 'work-9', detailAvailable: true });

    expect(view.container.textContent).toContain('正在准备…');
    expect(view.container.textContent).toContain('下载与解析完成后会出现在书库');
    expect(view.container.querySelector('a[href^="/works/work-9"]')).toBeNull();
    expect(view.container.textContent).not.toContain('查看详情');
    view.cleanup();
  });

  it('hydrates the ready state on refresh with the actual Work entry and Library link', async () => {
    mocks.useSourceRecordSaveStatusQuery.mockReturnValue({
      data: { status: 'ready', workId: 'work-5', failureReason: null },
    });
    // A refreshed `ready` state pairs with a refreshed list that reports the
    // entry available for this member, so the detail entry reappears.
    const view = await renderCard('zh-CN', { ...item, detailAvailable: true });

    expect(view.container.textContent).toContain('已在书库');
    expect(view.container.querySelector('a[href^="/works/work-5"]')).toBeTruthy();
    expect(view.container.querySelector('a[href="/library"]')).toBeTruthy();
    expect(view.invalidateSpy).toHaveBeenCalledWith({ queryKey: ['discover', 'records'] });
    view.cleanup();
  });

  it('keeps a saved-and-ready card without a detail entry when the Work is not openable', async () => {
    mocks.useSourceRecordSaveStatusQuery.mockReturnValue({
      data: { status: 'ready', workId: 'work-5', failureReason: null },
    });
    const view = await renderCard('zh-CN', { ...item, detailAvailable: false });

    expect(view.container.textContent).toContain('已在书库');
    expect(view.container.querySelector('a[href^="/works/work-5"]')).toBeNull();
    expect(view.container.textContent).not.toContain('查看详情');
    expect(view.container.querySelector('a[href="/library"]')).toBeTruthy();
    view.cleanup();
  });

  it('shows the failed server state with its reason and retries through the Save Intent', async () => {
    mocks.useSourceRecordSaveStatusQuery.mockReturnValue({
      data: { status: 'failed', workId: 'work-3', failureReason: 'HTTP 502 for EPUB' },
    });
    mocks.saveSourceRecordToLibrary.mockResolvedValue({ status: 'pending', workId: 'work-3' });
    const view = await renderCard('zh-CN', { ...item, linkedWorkId: 'work-3', detailAvailable: true });

    expect(view.container.textContent).toContain('HTTP 502 for EPUB');
    expect(view.container.textContent).not.toContain('查看详情');
    expect(view.container.querySelector('a[href^="/works/work-3"]')).toBeNull();

    await act(async () => {
      buttonByText(view.container, '重试')?.click();
    });
    await flush();

    expect(mocks.saveSourceRecordToLibrary).toHaveBeenCalledWith('sr-1');
    expect(view.container.textContent).toContain('正在准备…');
    view.cleanup();
  });
});

describe('DiscoverSourceCard layout reservation', () => {
  it('reserves a one-line author row even when the item has no author', async () => {
    const view = await renderCard('zh-CN', { ...item, author: '' });
    const article = view.container.querySelector('article');
    expect(article?.className).toContain('h-full');
    // The metadata column stretches so the action area sits at a stable bottom.
    expect(article?.className).toContain('items-stretch');
    const meta = article?.querySelector('h3')?.parentElement;
    expect(meta?.className).toContain('flex-1');
    // Reserved one-line author row even when the item has no author.
    const authorRow = meta?.querySelector('p');
    expect(authorRow?.className).toContain('min-h-[1lh]');
    view.cleanup();
  });

  it('keeps the two-line title reservation classes on the heading', async () => {
    const view = await renderCard('zh-CN', item);
    const heading = view.container.querySelector('h3');
    expect(heading?.className).toContain('line-clamp-2');
    expect(heading?.className).toContain('min-h-[2lh]');
    view.cleanup();
  });

  it('pins the action area to the bottom of the card column', async () => {
    const view = await renderCard('zh-CN', item);
    // The action area is the last block of the metadata column (its parent may
    // hold the categories list before it).
    const meta = view.container.querySelector('article h3')?.parentElement;
    const actionArea = meta?.lastElementChild;
    expect(actionArea?.className).toContain('mt-auto');
    view.cleanup();
  });

  it('keeps category badges renderable without clipping classes on the list', async () => {
    const view = await renderCard('zh-CN', item);
    const list = view.container.querySelector('article ul');
    expect(list?.className).not.toContain('overflow-hidden');
    expect(view.container.textContent).toContain('科幻');
    view.cleanup();
  });
});

describe('DiscoverSourceCard cleaned title display', () => {
  it('exposes the same full cleaned title in the heading, tooltip, and cover aria-label', async () => {
    const cleanedTitle = 'Sense and Sensibility A novel';
    const view = await renderCard('en-US', {
      ...item,
      title: cleanedTitle,
      linkedWorkId: 'work-1',
      detailAvailable: true,
    });
    const heading = view.container.querySelector('h3');
    // The two-line clamp is visual only: the full title stays in the DOM text
    // and the tooltip, so screen readers and hover users see the same string.
    expect(heading?.textContent).toBe(cleanedTitle);
    expect(heading?.getAttribute('title')).toBe(cleanedTitle);
    const coverLink = view.container.querySelector('article > a');
    expect(coverLink?.getAttribute('aria-label')).toBe(`View details for ${cleanedTitle}`);
    view.cleanup();
  });
});
