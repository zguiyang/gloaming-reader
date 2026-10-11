// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '@/lib/api-request';
import { LocaleProvider } from '@/lib/locale-context';

import type { DiscoverItem } from './discover-model';
import { DiscoverSourceCard } from './discover-source-card';

const mocks = vi.hoisted(() => ({
  saveSourceRecordToLibrary: vi.fn(),
  openLogin: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock('@/features/discover/discover-api', () => ({
  saveSourceRecordToLibrary: mocks.saveSourceRecordToLibrary,
}));

vi.mock('@/features/auth', () => ({ useAuthDialog: () => ({ openLogin: mocks.openLogin }) }));
vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError, info: mocks.toastInfo },
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const item: DiscoverItem = {
  id: 'sr-1',
  linkedWorkId: null,
  title: 'Pride and Prejudice',
  author: 'Jane Austen',
  coverImageUrl: null,
  categories: [{ id: 'cat-1', name: '科幻' }],
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
  await act(async () => {
    root.render(
      // eslint-disable-next-line react/no-children-prop
      createElement(LocaleProvider, { locale, children: createElement(DiscoverSourceCard, { item: cardItem }) }),
    );
  });
  return {
    container,
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
});

describe('DiscoverSourceCard Save Intent', () => {
  it('creates a pending Save Intent on explicit click and never auto-saves', async () => {
    mocks.saveSourceRecordToLibrary.mockResolvedValue({ status: 'pending', workId: null });
    const view = await renderCard();

    expect(mocks.saveSourceRecordToLibrary).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain('加入书库');

    await act(async () => {
      buttonByText(view.container, '加入书库')?.click();
    });
    await flush();

    expect(mocks.saveSourceRecordToLibrary).toHaveBeenCalledWith('sr-1');
    expect(view.container.textContent).toContain('正在准备…');
    expect(view.container.textContent).toContain('下载与解析完成后会出现在书库');
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

  it('renders localized category chips without a Work-detail link', async () => {
    const view = await renderCard();
    expect(view.container.textContent).toContain('科幻');
    expect(view.container.querySelector('a')).toBeNull();
    view.cleanup();
  });

  it('keeps the existing Work-detail entry for a materialized SourceRecord', async () => {
    const view = await renderCard('zh-CN', { ...item, linkedWorkId: 'work-77' });

    expect(view.container.querySelector('a[href^="/works/work-77"]')).toBeTruthy();
    expect(view.container.textContent).toContain('查看详情');
    expect(view.container.textContent).not.toContain('加入书库');
    expect(mocks.saveSourceRecordToLibrary).not.toHaveBeenCalled();
    view.cleanup();
  });
});
