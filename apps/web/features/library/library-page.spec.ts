// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LibraryData } from '@gloaming/shared/library';

import { LocaleProvider } from '@/lib/locale-context';

import { LibraryPage } from './library-page';
import { LibraryTagsPage } from './library-tags-page';

const mocks = vi.hoisted(() => ({
  useLibraryQuery: vi.fn(),
  useUserTagsQuery: vi.fn(),
  uploadPersonalEpub: vi.fn(),
  personalEpubValidationError: vi.fn((file: Pick<File, 'name' | 'size'>): 'format' | 'size' | null =>
    file.name.toLowerCase().endsWith('.epub') ? null : 'format',
  ),
  removeFromLibrary: vi.fn(),
  createUserTag: vi.fn(),
  renameUserTag: vi.fn(),
  deleteUserTag: vi.fn(),
  assignUserTag: vi.fn(),
  unassignUserTag: vi.fn(),
  formatLibraryApiError: vi.fn((error: unknown) => String(error)),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  openLogin: vi.fn(),
}));

vi.mock('@/features/library/library-api', () => ({
  useLibraryQuery: mocks.useLibraryQuery,
  useUserTagsQuery: mocks.useUserTagsQuery,
  createUserTag: mocks.createUserTag,
  renameUserTag: mocks.renameUserTag,
  deleteUserTag: mocks.deleteUserTag,
  assignUserTag: mocks.assignUserTag,
  unassignUserTag: mocks.unassignUserTag,
  uploadPersonalEpub: mocks.uploadPersonalEpub,
  personalEpubValidationError: mocks.personalEpubValidationError,
  removeFromLibrary: mocks.removeFromLibrary,
  formatLibraryApiError: mocks.formatLibraryApiError,
  libraryQueryKey: { all: ['library'], tags: ['library', 'tags'] },
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
  mocks.useUserTagsQuery.mockReturnValue({ data: [] });
  mocks.createUserTag.mockResolvedValue({ id: 'tag-new', name: '新标签' });
  mocks.renameUserTag.mockResolvedValue({ id: 'tag-one', name: '更新' });
  mocks.deleteUserTag.mockResolvedValue(undefined);
  mocks.assignUserTag.mockResolvedValue(undefined);
  mocks.unassignUserTag.mockResolvedValue(undefined);
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
  return {
    work: work(id),
    state: null,
    availability,
    canRemoveFromLibrary,
    userTags: [],
  } as LibraryData['items'][number];
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

async function renderTagManagement(data: unknown) {
  mocks.useUserTagsQuery.mockReturnValue({ data });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => root.render(withProviders(createElement(LibraryTagsPage), client)));
  return {
    container,
    cleanup() {
      void act(() => root.unmount());
      container.remove();
    },
  };
}

function updateInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
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
    expect(empty.container.querySelector('button')).toBeTruthy();
    expect(empty.container.textContent).not.toContain('上传 EPUB');
    expect(empty.container.querySelector('header button')).toBeNull();
    await act(async () => (empty.container.querySelector('button') as HTMLButtonElement)?.click());
    expect(document.body.textContent).toContain('将 EPUB 拖到这里');
    expect(document.body.textContent).toContain('支持 EPUB · 最大 50 MB');
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
    expect(view.container.querySelectorAll('button[aria-label^="管理《"]')).toHaveLength(2);
    view.cleanup();
  });

  it('filters only the Library grid by User Tags and keeps Continue Reading independent', async () => {
    const favorite = { id: 'tag-favorite', name: '喜欢' };
    const data = {
      current: { work: work('current'), state: { currentPartId: 'part-2', progressRatio: 20 } },
      items: [{ ...item('favorite', false), userTags: [favorite] }, item('untagged', false)],
    } as unknown as LibraryData;
    mocks.useUserTagsQuery.mockReturnValue({ data: [{ ...favorite, bookCount: 1 }] });
    const view = await renderLibrary({ isPending: false, isError: false, data });

    expect(view.container.querySelector('a[href="/library/tags"]')?.textContent).toBe('管理标签');
    await act(async () => {
      Array.from(view.container.querySelectorAll('button'))
        .find((button) => button.textContent === '喜欢')
        ?.click();
    });
    expect(view.container.querySelector('a[href="/read/current?part=part-2"]')).toBeTruthy();
    expect(view.container.querySelector('a[href="/read/favorite"]')).toBeTruthy();
    expect(view.container.querySelector('a[href="/read/untagged"]')).toBeNull();
    view.cleanup();
  });

  it('provides tag management and explains that deleting a tag keeps books', async () => {
    const view = await renderTagManagement([{ id: 'tag-one', name: '喜欢', bookCount: 2 }]);
    expect(view.container.textContent).toContain('管理标签');
    expect(view.container.textContent).toContain('用于 2 本书');
    const deleteButton = view.container.querySelector('button[aria-label="删除标签: 喜欢"]') as HTMLButtonElement;
    await act(async () => deleteButton.click());
    expect(document.body.textContent).toContain('此标签用于 2 本书。删除标签不会删除书籍。');
    const confirm = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent === '删除标签',
    );
    await act(async () => confirm?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(mocks.deleteUserTag).toHaveBeenCalledWith('tag-one');
    view.cleanup();
  });

  it('creates and renames tags from the management page', async () => {
    const view = await renderTagManagement([{ id: 'tag-one', name: '喜欢', bookCount: 1 }]);
    const createInput = view.container.querySelector('form input') as HTMLInputElement;
    await act(async () => updateInput(createInput, '以后再读'));
    const createButton = Array.from(view.container.querySelectorAll('button')).find(
      (button) => button.textContent === '创建标签',
    );
    await act(async () => createButton?.click());
    expect(mocks.createUserTag).toHaveBeenCalledWith('以后再读');

    const renameButton = view.container.querySelector('button[aria-label="重命名: 喜欢"]') as HTMLButtonElement;
    await act(async () => renameButton.click());
    const editForm = view.container.querySelector('li form') as HTMLFormElement;
    const editInput = editForm.querySelector('input') as HTMLInputElement;
    await act(async () => updateInput(editInput, '更新后的标签'));
    await act(async () => (editForm.querySelector('button[type="submit"]') as HTMLButtonElement).click());
    expect(mocks.renameUserTag).toHaveBeenCalledWith('tag-one', '更新后的标签');
    view.cleanup();
  });

  it('assigns and unassigns tags from a Ready book through its management menu', async () => {
    const tags = [
      { id: 'tag-one', name: '喜欢', bookCount: 1 },
      { id: 'tag-two', name: '以后再读', bookCount: 0 },
    ];
    mocks.useUserTagsQuery.mockReturnValue({ data: tags });
    const entry = { ...item('book', false), userTags: [{ id: 'tag-one', name: '喜欢' }] };
    const view = await renderLibrary({ isPending: false, isError: false, data: { current: null, items: [entry] } });
    await act(async () =>
      (view.container.querySelector('button[aria-label="管理《Book book》"]') as HTMLButtonElement).click(),
    );
    const manageItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find((element) =>
      element.textContent?.includes('管理标签'),
    );
    await act(async () => (manageItem as HTMLElement).click());

    const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    expect(checkboxes.map((checkbox) => checkbox.checked)).toEqual([true, false]);
    await act(async () => {
      checkboxes[0]?.click();
      checkboxes[1]?.click();
    });
    const save = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '保存标签');
    await act(async () => save?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(mocks.unassignUserTag).toHaveBeenCalledWith('book', 'tag-one');
    expect(mocks.assignUserTag).toHaveBeenCalledWith('book', 'tag-two');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('标签已更新');
    view.cleanup();
  });

  it('shows processing and failed books as non-readable states without fake recovery actions', async () => {
    const data = {
      current: null,
      items: [item('processing', false, 'processing'), item('failed', false, 'failed')],
    } as LibraryData;
    const view = await renderLibrary({ isPending: false, isError: false, data });

    expect(view.container.textContent).toContain('正在整理书籍…');
    expect(view.container.textContent).toContain('导入失败');
    expect(view.container.textContent).toContain('暂时无法读取这本书。');
    expect(view.container.querySelector('[role="progressbar"]')?.hasAttribute('aria-valuenow')).toBe(false);
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
    await act(async () => (view.container.querySelector('button') as HTMLButtonElement)?.click());
    const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
    const pickerClick = vi.spyOn(input, 'click');
    await act(async () =>
      (document.body.querySelector('button[aria-label="选择或拖入 EPUB 文件"]') as HTMLButtonElement)?.click(),
    );
    expect(pickerClick).toHaveBeenCalledOnce();
    const file = new File(['epub'], 'book.epub', { type: 'application/epub+zip' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mocks.uploadPersonalEpub).not.toHaveBeenCalled();
    const submitButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('上传 EPUB'),
    );
    await act(async () => submitButton?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(mocks.uploadPersonalEpub.mock.calls[0]?.[0]).toBe(file);
    expect(document.body.textContent).toContain('上传中…');
    expect(
      Array.from(document.body.querySelectorAll('button')).some(
        (button) => button.disabled && button.textContent?.includes('上传'),
      ),
    ).toBe(true);

    await act(async () => {
      finishUpload?.({ id: 'work-new', title: 'New book', processingStatus: 'uploaded' });
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith('已加入书库，正在处理');
    expect(invalidateLibrary).toHaveBeenCalledWith({ queryKey: ['library'] });
    view.cleanup();
  });

  it('rejects unsupported files and announces upload failures', async () => {
    const view = await renderLibrary({ isPending: false, isError: false, data: { current: null, items: [] } });
    await act(async () => (view.container.querySelector('button') as HTMLButtonElement)?.click());
    const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
    const invalid = new File(['pdf'], 'book.pdf', { type: 'application/pdf' });
    mocks.personalEpubValidationError.mockReturnValueOnce('format');
    Object.defineProperty(input, 'files', { configurable: true, value: [invalid] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(document.body.textContent).toContain('请选择 EPUB 文件');
    expect(mocks.uploadPersonalEpub).not.toHaveBeenCalled();

    mocks.uploadPersonalEpub.mockRejectedValue(new Error('Upload failed'));
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['epub'], 'book.epub', { type: 'application/epub+zip' })],
    });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    const submitButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('上传 EPUB'),
    );
    await act(async () => submitButton?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(mocks.uploadPersonalEpub).toHaveBeenCalledOnce();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
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
