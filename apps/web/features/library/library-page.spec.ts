// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LibraryData } from '@gloaming/shared/library';

import { LocaleProvider } from '@/lib/locale-context';

import { LibraryPage } from './library-page';

const mocks = vi.hoisted(() => ({
  useLibraryQuery: vi.fn(),
  uploadPersonalEpub: vi.fn(),
  personalEpubValidationError: vi.fn((file: Pick<File, 'name' | 'size'>): 'format' | 'size' | null =>
    file.name.toLowerCase().endsWith('.epub') ? null : 'format',
  ),
  removeFromLibrary: vi.fn(),
  formatLibraryApiError: vi.fn((error: unknown) => String(error)),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  openLogin: vi.fn(),
}));

vi.mock('@/features/library/library-api', () => ({
  useLibraryQuery: mocks.useLibraryQuery,
  uploadPersonalEpub: mocks.uploadPersonalEpub,
  personalEpubValidationError: mocks.personalEpubValidationError,
  removeFromLibrary: mocks.removeFromLibrary,
  formatLibraryApiError: mocks.formatLibraryApiError,
  libraryQueryKey: { all: ['library'] },
}));

vi.mock('@/features/auth', () => ({ useAuthDialog: () => ({ openLogin: mocks.openLogin }) }));
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.personalEpubValidationError.mockReturnValue(null);
  mocks.removeFromLibrary.mockResolvedValue(undefined);
});

function work(id: string) {
  return {
    id,
    title: `Book ${id}`,
    description: '',
    tags: [],
    coverAssetId: null,
    publishedAt: null,
  };
}

function item(id: string, canRemoveFromLibrary: boolean, availability: 'processing' | 'ready' | 'failed' = 'ready') {
  return { work: work(id), state: null, availability, canRemoveFromLibrary } as LibraryData['items'][number];
}

function withProviders(node: ReactElement, client: QueryClient) {
  return createElement(
    QueryClientProvider,
    { client },
    // eslint-disable-next-line react/no-children-prop
    createElement(LocaleProvider, { locale: 'zh-CN', children: node }),
  );
}

async function renderLibrary(result: unknown) {
  mocks.useLibraryQuery.mockReturnValue(result);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => root.render(withProviders(createElement(LibraryPage), client)));
  return {
    container,
    root,
    client,
    cleanup() {
      void act(() => root.unmount());
      container.remove();
    },
  };
}

describe('LibraryPage', () => {
  it('renders loading, empty, and retryable error states', async () => {
    const loading = await renderLibrary({ isPending: true, isError: false });
    expect(loading.container.textContent).toContain('书库');
    expect(loading.container.querySelectorAll('[aria-hidden="true"]')).not.toHaveLength(0);
    loading.cleanup();

    const empty = await renderLibrary({ isPending: false, isError: false, data: { current: null, items: [] } });
    expect(empty.container.textContent).toContain('你的书库还是空的');
    expect(empty.container.textContent).toContain('发现一本书开始阅读');
    expect(empty.container.textContent).toContain('上传 EPUB');
    empty.cleanup();

    const error = await renderLibrary({ isPending: false, isError: true, error: new Error('network') });
    expect(error.container.textContent).toContain('无法加载书库');
    expect(error.container.textContent).toContain('重试');
    error.cleanup();
  });

  it('shows Continue Reading and opens owned and saved books directly in Reader', async () => {
    const data = {
      current: { work: work('current'), state: { currentPartId: 'part-2', progressRatio: 20 } },
      items: [item('personal', false), item('catalog', true)],
    } as unknown as LibraryData;
    const view = await renderLibrary({ isPending: false, isError: false, data });

    expect(view.container.textContent).toContain('继续阅读');
    expect(view.container.querySelector('a[href="/read/current?part=part-2"]')).toBeTruthy();
    expect(view.container.querySelector('a[href="/read/personal"]')).toBeTruthy();
    expect(view.container.querySelector('a[href="/read/catalog"]')).toBeTruthy();
    expect(view.container.querySelector('a[href^="/discover/"]')).toBeNull();
    expect(view.container.querySelectorAll('button[aria-label^="管理《"]')).toHaveLength(1);
    view.cleanup();
  });

  it('shows processing and failed books as non-readable states without fake recovery actions', async () => {
    const data = {
      current: null,
      items: [item('processing', false, 'processing'), item('failed', false, 'failed')],
    } as LibraryData;
    const view = await renderLibrary({ isPending: false, isError: false, data });

    expect(view.container.textContent).toContain('正在处理');
    expect(view.container.textContent).toContain('这本书处理失败');
    expect(view.container.querySelector('a[href="/read/processing"]')).toBeNull();
    expect(view.container.querySelector('a[href="/read/failed"]')).toBeNull();
    expect(view.container.textContent).not.toContain('重试');
    expect(view.container.querySelectorAll('button[aria-label^="管理《"]')).toHaveLength(0);
    view.cleanup();
  });

  it('validates the selected file, shows pending feedback, then refreshes Library', async () => {
    let finishUpload: ((result: { id: string; title: string; processingStatus: string }) => void) | undefined;
    mocks.uploadPersonalEpub.mockReturnValue(
      new Promise((resolve) => {
        finishUpload = resolve;
      }),
    );
    const view = await renderLibrary({ isPending: false, isError: false, data: { current: null, items: [] } });
    const invalidateLibrary = vi.spyOn(view.client, 'invalidateQueries');
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    const pickerClick = vi.spyOn(input, 'click');
    const uploadButton = Array.from(view.container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('上传 EPUB'),
    );
    await act(async () => uploadButton?.click());
    expect(pickerClick).toHaveBeenCalledOnce();
    const file = new File(['epub'], 'book.epub', { type: 'application/epub+zip' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mocks.uploadPersonalEpub.mock.calls[0]?.[0]).toBe(file);
    const pendingButton = Array.from(view.container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('上传中'),
    );
    expect(pendingButton?.disabled).toBe(true);

    await act(async () => {
      finishUpload?.({ id: 'work-new', title: 'New book', processingStatus: 'uploaded' });
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith('已加入书库，正在处理');
    expect(invalidateLibrary).toHaveBeenCalledWith({ queryKey: ['library'] });
    view.cleanup();
  });

  it('rejects unsupported files and announces upload failures', async () => {
    const view = await renderLibrary({ isPending: false, isError: false, data: { current: null, items: [] } });
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    const invalid = new File(['pdf'], 'book.pdf', { type: 'application/pdf' });
    mocks.personalEpubValidationError.mockReturnValueOnce('format');
    Object.defineProperty(input, 'files', { configurable: true, value: [invalid] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(mocks.toastError).toHaveBeenCalledWith('请选择 EPUB 文件');
    expect(mocks.uploadPersonalEpub).not.toHaveBeenCalled();

    mocks.uploadPersonalEpub.mockRejectedValue(new Error('Upload failed'));
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['epub'], 'book.epub', { type: 'application/epub+zip' })],
    });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await act(async () => Promise.resolve());
    expect(mocks.toastError).toHaveBeenCalledWith('Error: Upload failed');
    view.cleanup();
  });

  it('confirms and removes a saved Catalog book using Library membership semantics', async () => {
    const view = await renderLibrary({
      isPending: false,
      isError: false,
      data: { current: null, items: [item('catalog', true)] },
    });
    const menuTrigger = view.container.querySelector('button[aria-label="管理《Book catalog》"]') as HTMLButtonElement;
    await act(async () => menuTrigger.click());
    const removeMenuItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find((element) =>
      element.textContent?.includes('移出书库'),
    );
    expect(removeMenuItem).toBeTruthy();
    await act(async () => (removeMenuItem as HTMLElement).click());
    expect(document.body.textContent).toContain('此书将从书库移除，阅读进度和历史记录会保留。');
    const confirm = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '移出书库');
    await act(async () => confirm?.click());
    expect(mocks.removeFromLibrary).toHaveBeenCalledWith('catalog');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('已移出书库');
    view.cleanup();
  });
});
