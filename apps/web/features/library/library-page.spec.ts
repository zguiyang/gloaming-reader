// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as NextNavigation from 'next/navigation';
import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LibraryData } from '@gloaming/shared/library';
import type { ReadingStateStatus } from '@gloaming/shared/reader';

import { ApiRequestError } from '@/lib/api-request';
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
  updatePersonalWork: vi.fn(),
  deletePersonalWork: vi.fn(),
  createUserTag: vi.fn(),
  completeUserTagTranslations: vi.fn(),
  renameUserTag: vi.fn(),
  deleteUserTag: vi.fn(),
  assignUserTag: vi.fn(),
  unassignUserTag: vi.fn(),
  formatLibraryApiError: vi.fn((error: unknown) => String(error)),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  openLogin: vi.fn(),
  navigatePush: vi.fn(),
  navigateReplace: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock('@/features/library/library-api', () => ({
  useLibraryQuery: mocks.useLibraryQuery,
  useUserTagsQuery: mocks.useUserTagsQuery,
  createUserTag: mocks.createUserTag,
  completeUserTagTranslations: mocks.completeUserTagTranslations,
  renameUserTag: mocks.renameUserTag,
  deleteUserTag: mocks.deleteUserTag,
  assignUserTag: mocks.assignUserTag,
  unassignUserTag: mocks.unassignUserTag,
  uploadPersonalEpub: mocks.uploadPersonalEpub,
  personalEpubValidationError: mocks.personalEpubValidationError,
  removeFromLibrary: mocks.removeFromLibrary,
  updatePersonalWork: mocks.updatePersonalWork,
  deletePersonalWork: mocks.deletePersonalWork,
  formatLibraryApiError: mocks.formatLibraryApiError,
  libraryQueryKey: { all: ['library'], tags: ['library', 'tags'] },
}));

vi.mock('@/features/auth', () => ({ useAuthDialog: () => ({ openLogin: mocks.openLogin }) }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof NextNavigation>();
  return {
    ...actual,
    usePathname: () => '/library',
    useRouter: () => ({ push: mocks.navigatePush, replace: mocks.navigateReplace }),
    useSearchParams: () => mocks.searchParams,
  };
});
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError, info: mocks.toastInfo } }));
vi.mock('@/features/discover/discover-api', () => ({
  discoverQueryKey: {
    all: ['discover'] as const,
    records: (params: unknown) => ['discover', 'records', params] as const,
    saveStatus: (sourceRecordId: string, userId: string | null) =>
      ['discover', 'save-status', userId, sourceRecordId] as const,
  },
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.searchParams = new URLSearchParams();
  mocks.personalEpubValidationError.mockReturnValue(null);
  mocks.removeFromLibrary.mockResolvedValue(undefined);
  mocks.updatePersonalWork.mockResolvedValue({ id: 'book', title: 'Updated', author: 'Author', description: 'Note' });
  mocks.deletePersonalWork.mockResolvedValue(undefined);
  mocks.useUserTagsQuery.mockReturnValue({ data: [] });
  mocks.createUserTag.mockResolvedValue({ id: 'tag-new', name: '新标签' });
  mocks.completeUserTagTranslations.mockResolvedValue({
    status: 'provider_unavailable',
    tag: { id: 'tag-new', name: '新标签' },
  });
  mocks.renameUserTag.mockResolvedValue({ id: 'tag-one', name: '更新' });
  mocks.deleteUserTag.mockResolvedValue(undefined);
  mocks.assignUserTag.mockResolvedValue(undefined);
  mocks.unassignUserTag.mockResolvedValue(undefined);
});

// Safety net: when an assertion fails, the test's own view.cleanup() never runs and its
// open dialog/menu portals would leak into document.body and poison later tests.
const renderedRoots: Array<() => void> = [];

afterEach(() => {
  while (renderedRoots.length) renderedRoots.pop()?.();
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
    libraryItemKind: canRemoveFromLibrary ? 'saved_catalog' : 'personal',
    personalMetadata: canRemoveFromLibrary ? null : { author: '' },
    canRemoveFromLibrary,
    userTags: [],
  } as LibraryData['items'][number];
}

function withProviders(node: ReactElement, client: QueryClient, locale: 'zh-CN' | 'en-US' = 'zh-CN') {
  return createElement(
    QueryClientProvider,
    { client },
    // eslint-disable-next-line react/no-children-prop
    createElement(LocaleProvider, { locale, children: node }),
  );
}

async function renderLibrary(result: unknown, locale: 'zh-CN' | 'en-US' = 'zh-CN') {
  mocks.useLibraryQuery.mockReturnValue(result);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const render = async () => {
    await act(async () => root.render(withProviders(createElement(LibraryPage), client, locale)));
  };
  await render();
  return {
    container,
    root,
    client,
    async navigate(search: string) {
      mocks.searchParams = new URLSearchParams(search);
      await render();
    },
    /** Re-render the same tree so mocked query hooks can supply refreshed fixture data. */
    async rerender() {
      await render();
    },
    cleanup: registerRootCleanup(root, container),
  };
}

/** Idempotent cleanup that also runs from afterEach when a failing test skips it. */
function registerRootCleanup(root: ReturnType<typeof createRoot>, container: HTMLElement) {
  let isCleaned = false;
  const cleanup = () => {
    if (isCleaned) return;
    isCleaned = true;
    void act(() => root.unmount());
    container.remove();
  };
  renderedRoots.push(cleanup);
  return cleanup;
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
    client,
    cleanup: registerRootCleanup(root, container),
  };
}

function updateInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function buttonByLabel(container: ParentNode, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent === label);
}

function tagButton(container: ParentNode, name: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.startsWith(name));
}

/** A promise whose settlement the test controls, to force a specific request ordering. */
function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<unknown>((settleResolve, settleReject) => {
    resolve = () => settleResolve(undefined);
    reject = settleReject;
  });
  return { promise, resolve, reject };
}

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

/** Open the tag-assignment dialog for `Book book` through its management menu. */
async function openTagAssignmentDialog(view: Awaited<ReturnType<typeof renderLibrary>>) {
  await act(async () =>
    (view.container.querySelector('button[aria-label="管理《Book book》"]') as HTMLButtonElement).click(),
  );
  const manageItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find((element) =>
    element.textContent?.includes('管理标签'),
  );
  await act(async () => (manageItem as HTMLElement).click());
}

function dialogCheckboxes() {
  return Array.from(document.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
}

function saveTagsButton() {
  return Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '保存标签');
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
    expect(empty.container.textContent).not.toContain('上传书籍');
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

  it('shows the Library truncation hint only when the response is truncated', async () => {
    const data = { current: null, items: [item('book', false)] };

    const truncated = await renderLibrary({ isPending: false, isError: false, data: { ...data, isTruncated: true } });
    expect(truncated.container.textContent).toContain('书库仅显示前 48 本书');
    expect(truncated.container.textContent).toContain('可用标签或来源筛选查看其余书籍');
    // The hint is advisory copy: the grid still renders underneath it.
    expect(truncated.container.querySelector('a[href="/works/book?returnTo=%2Flibrary"]')).toBeTruthy();
    truncated.cleanup();

    const complete = await renderLibrary({
      isPending: false,
      isError: false,
      data: { ...data, isTruncated: false },
    });
    expect(complete.container.textContent).not.toContain('书库仅显示前 48 本书');
    complete.cleanup();

    const english = await renderLibrary(
      { isPending: false, isError: false, data: { ...data, isTruncated: true } },
      'en-US',
    );
    expect(english.container.textContent).toContain('Only the first 48 books are shown');
    english.cleanup();
  });

  it('opens the existing login dialog and exits loading after an unauthenticated Library response', async () => {
    const view = await renderLibrary({
      isPending: false,
      isError: true,
      error: new ApiRequestError({ message: '未登录', status: 401 }),
    });

    expect(mocks.openLogin).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toContain('书库');
    expect(view.container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
    view.cleanup();
  });

  it('keeps Continue Reading direct to Reader and opens grid books in Work detail', async () => {
    const data = {
      current: { work: work('current'), state: { currentPartId: 'part-2', progressRatio: 20 } },
      items: [item('personal', false), item('catalog', true)],
    } as unknown as LibraryData;
    const view = await renderLibrary({ isPending: false, isError: false, data });

    expect(view.container.textContent).toContain('继续阅读');
    expect(view.container.querySelector('a[href="/read/current?part=part-2"]')).toBeTruthy();
    expect(view.container.querySelector('a[href="/read/personal"]')).toBeTruthy();
    expect(view.container.querySelector('a[href="/read/catalog"]')).toBeTruthy();
    expect(view.container.querySelector('a[href="/works/personal?returnTo=%2Flibrary"]')).toBeTruthy();
    expect(view.container.querySelector('a[href="/works/catalog?returnTo=%2Flibrary"]')).toBeTruthy();
    expect(view.container.querySelector('a[href^="/discover/"]')).toBeNull();
    expect(view.container.querySelectorAll('button[aria-label^="管理《"]')).toHaveLength(2);
    view.cleanup();
  });

  it('derives Library status from Reading State instead of the progress ratio', async () => {
    const readingState = (status: ReadingStateStatus, progressRatio: number, currentPartId: string | null = null) => ({
      status,
      currentPartId,
      progressRatio,
    });
    const data = {
      current: { work: work('current'), state: readingState('in_progress', 0, 'part-2') },
      items: [
        { ...item('unread', false), state: null },
        { ...item('current', false), state: readingState('in_progress', 0, 'part-2') },
        { ...item('reading', false), state: readingState('in_progress', 40, 'part-1') },
        { ...item('finished', false), state: readingState('completed', 100) },
      ],
    } as unknown as LibraryData;
    const view = await renderLibrary({ isPending: false, isError: false, data });

    const cardFor = (id: string) =>
      Array.from(view.container.querySelectorAll('article')).find((article) =>
        article.textContent?.includes(`Book ${id}`),
      );
    const statusTextFor = (id: string) =>
      Array.from(cardFor(id)?.querySelectorAll('p') ?? [])
        .map((paragraph) => paragraph.textContent)
        .find((text) => text !== `Book ${id}`);

    // Absent Reading State is the project enum's not-started representation.
    expect(statusTextFor('unread')).toBe('未开始');
    // Continue Reading and its grid card agree for the same in_progress Reading State, as History does for any
    // non-completed status, regardless of progressRatio.
    const continueHero = Array.from(view.container.querySelectorAll('section')).find((section) =>
      section.textContent?.includes('继续阅读'),
    );
    expect(continueHero?.querySelector('h2')?.textContent).toBe('继续阅读');
    expect(continueHero?.textContent).toContain('阅读中');
    expect(continueHero?.textContent).not.toContain('已读 0%');
    expect(continueHero?.querySelector('[role="progressbar"]')).toBeNull();
    expect(statusTextFor('current')).toBe('阅读中');
    expect(statusTextFor('reading')).toBe('阅读中');
    expect(statusTextFor('current')).not.toBe('未开始');
    expect(statusTextFor('reading')).not.toBe('已读 40%');
    // The percentage stays a separate progress indicator, not the status copy.
    expect(cardFor('reading')?.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe('已读 40%');
    expect(cardFor('reading')?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('40');
    // completed keeps the existing completed copy.
    expect(statusTextFor('finished')).toBe('已读完');

    view.cleanup();
  });

  it('combines source and User Tag filters with AND and keeps Continue Reading independent', async () => {
    const favorite = { id: 'tag-favorite', name: '喜欢' };
    const english = { id: 'tag-english', name: '英语学习' };
    const data = {
      current: { work: work('current'), state: { currentPartId: 'part-2', progressRatio: 20 } },
      items: [
        { ...item('personal-english', false), userTags: [english] },
        { ...item('personal-favorite', false), userTags: [favorite] },
        { ...item('saved-favorite', true), userTags: [favorite] },
        { ...item('saved-english', true), userTags: [english] },
      ],
    } as unknown as LibraryData;
    mocks.useUserTagsQuery.mockReturnValue({
      data: [
        { ...favorite, bookCount: 2 },
        { ...english, bookCount: 2 },
      ],
    });
    const view = await renderLibrary({ isPending: false, isError: false, data });

    expect(view.container.querySelector('a[href="/library/tags"]')?.textContent).toBe('管理标签');
    await act(async () => {
      Array.from(view.container.querySelectorAll('button'))
        .find((button) => button.textContent === '我的上传')
        ?.click();
    });
    await act(async () => {
      Array.from(view.container.querySelectorAll('button'))
        .find((button) => button.textContent?.startsWith('英语学习'))
        ?.click();
    });
    expect(view.container.querySelector('a[href="/read/current?part=part-2"]')).toBeTruthy();
    expect(
      view.container.querySelector(
        'a[href="/works/personal-english?returnTo=%2Flibrary%3Fsource%3Dpersonal%26tag%3Dtag-english"]',
      ),
    ).toBeTruthy();
    expect(view.container.querySelector('a[href="/read/personal-favorite"]')).toBeNull();
    expect(view.container.querySelector('a[href="/read/saved-english"]')).toBeNull();

    await act(async () => {
      Array.from(view.container.querySelectorAll('button'))
        .find((button) => button.textContent === '已保存')
        ?.click();
    });
    await act(async () => {
      Array.from(view.container.querySelectorAll('button'))
        .find((button) => button.textContent?.startsWith('喜欢'))
        ?.click();
    });
    expect(view.container.querySelector('a[href="/read/current?part=part-2"]')).toBeTruthy();
    expect(
      view.container.querySelector(
        'a[href="/works/saved-favorite?returnTo=%2Flibrary%3Fsource%3Dsaved%26tag%3Dtag-favorite"]',
      ),
    ).toBeTruthy();
    expect(view.container.querySelector('a[href="/read/personal-favorite"]')).toBeNull();
    expect(view.container.querySelector('a[href="/read/saved-english"]')).toBeNull();
    view.cleanup();
  });

  it('keeps the Continue Reading Work eligible for All Books and My Upload while excluding it from Saved Catalog', async () => {
    const favorite = { id: 'tag-favorite', name: '喜欢' };
    const data = {
      current: { work: work('current'), state: { currentPartId: 'part-2', progressRatio: 20 } },
      items: [{ ...item('current', false), userTags: [favorite] }, item('saved', true)],
    } as unknown as LibraryData;
    mocks.useUserTagsQuery.mockReturnValue({ data: [{ ...favorite, bookCount: 1 }] });
    const view = await renderLibrary({ isPending: false, isError: false, data });

    // Continue Reading still renders the hero for the same Work.
    expect(view.container.textContent).toContain('继续阅读');
    expect(view.container.querySelector('a[href="/read/current?part=part-2"]')).toBeTruthy();
    // The same Work remains eligible for the All Books grid and keeps its management action.
    expect(view.container.querySelector('a[href="/works/current?returnTo=%2Flibrary"]')).toBeTruthy();
    expect(view.container.querySelector('button[aria-label="管理《Book current》"]')).toBeTruthy();

    // Saved Catalog never contains the Personal current Work.
    await act(async () => {
      Array.from(view.container.querySelectorAll('button'))
        .find((button) => button.textContent === '已保存')
        ?.click();
    });
    expect(view.container.querySelector('a[href="/works/current?returnTo=%2Flibrary"]')).toBeNull();
    expect(view.container.querySelector('a[href="/read/saved"]')).toBeTruthy();

    // My Upload and the User Tag filter still compose for the current Work.
    await act(async () => {
      Array.from(view.container.querySelectorAll('button'))
        .find((button) => button.textContent === '我的上传')
        ?.click();
    });
    await act(async () => {
      Array.from(view.container.querySelectorAll('button'))
        .find((button) => button.textContent?.startsWith('喜欢'))
        ?.click();
    });
    expect(
      view.container.querySelector(
        'a[href="/works/current?returnTo=%2Flibrary%3Fsource%3Dpersonal%26tag%3Dtag-favorite"]',
      ),
    ).toBeTruthy();
    expect(view.container.querySelector('a[href="/read/current?part=part-2"]')).toBeTruthy();
    expect(view.container.querySelector('a[href="/read/saved"]')).toBeNull();
    view.cleanup();
  });

  it('provides tag management and explains that deleting a tag keeps books', async () => {
    const view = await renderTagManagement([{ id: 'tag-one', name: '喜欢', bookCount: 2 }]);
    expect(view.container.textContent).toContain('管理标签');
    expect(view.container.textContent).not.toContain('用标签整理书库中的书籍');
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

  it('marks AI-created tags with a badge and leaves manual tags unmarked', async () => {
    const view = await renderTagManagement([
      {
        id: 'tag-ai',
        name: '太空歌剧',
        localizedNames: { 'zh-CN': '太空歌剧' },
        sourceLocale: 'zh-CN',
        userEditedLocales: ['zh-CN'],
        createdBy: 'ai',
        bookCount: 1,
      },
      {
        id: 'tag-manual',
        name: '喜欢',
        localizedNames: { 'zh-CN': '喜欢' },
        sourceLocale: 'zh-CN',
        userEditedLocales: ['zh-CN'],
        createdBy: 'manual',
        bookCount: 2,
      },
    ]);
    const itemFor = (name: string) =>
      Array.from(view.container.querySelectorAll('li')).find((entry) => entry.textContent?.includes(name));

    expect(itemFor('太空歌剧')?.textContent).toContain('AI 生成');
    expect(itemFor('喜欢')?.textContent).not.toContain('AI 生成');
    view.cleanup();
  });

  it('shows the AI badge in the tag assignment dialog only for AI-created tags', async () => {
    mocks.useUserTagsQuery.mockReturnValue({
      data: [
        { id: 'tag-ai', name: '太空歌剧', bookCount: 1, createdBy: 'ai' },
        { id: 'tag-manual', name: '喜欢', bookCount: 0, createdBy: 'manual' },
      ],
    });
    const view = await renderLibrary({
      isPending: false,
      isError: false,
      data: { current: null, items: [item('book', false)] },
    });
    await openTagAssignmentDialog(view);
    const labels = Array.from(document.querySelectorAll('[role="dialog"] label'));
    const aiLabel = labels.find((label) => label.textContent?.includes('太空歌剧'));
    const manualLabel = labels.find((label) => label.textContent?.includes('喜欢'));

    expect(aiLabel?.textContent).toContain('AI 生成');
    expect(manualLabel?.textContent).not.toContain('AI 生成');
    view.cleanup();
  });

  it('creates and renames tags from the management page', async () => {
    const view = await renderTagManagement([{ id: 'tag-one', name: '喜欢', bookCount: 1 }]);
    const invalidateQueries = vi.spyOn(view.client, 'invalidateQueries');
    const createInput = view.container.querySelector('form input') as HTMLInputElement;
    await act(async () => updateInput(createInput, '以后再读'));
    const createButton = Array.from(view.container.querySelectorAll('button')).find(
      (button) => button.textContent === '创建标签',
    );
    await act(async () => createButton?.click());
    expect(mocks.createUserTag).toHaveBeenCalledWith('以后再读', 'zh-CN');

    const renameButton = view.container.querySelector('button[aria-label="重命名: 喜欢"]') as HTMLButtonElement;
    await act(async () => renameButton.click());
    const editForm = view.container.querySelector('li form') as HTMLFormElement;
    const editInput = editForm.querySelector('input') as HTMLInputElement;
    await act(async () => updateInput(editInput, '更新后的标签'));
    await act(async () => (editForm.querySelector('button[type="submit"]') as HTMLButtonElement).click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(mocks.renameUserTag).toHaveBeenCalledWith('tag-one', '更新后的标签', 'zh-CN');
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['book-detail'] });
    view.cleanup();
  });

  it('partial rename failure refreshes to persisted state and keeps edits', async () => {
    mocks.renameUserTag
      .mockResolvedValueOnce({ id: 'tag-one', name: '最爱' })
      .mockRejectedValueOnce(new Error('patch failed'));
    const view = await renderTagManagement([
      {
        id: 'tag-one',
        name: '喜欢',
        localizedNames: { 'zh-CN': '喜欢', 'en-US': 'Like' },
        sourceLocale: 'zh-CN',
        userEditedLocales: ['zh-CN'],
        bookCount: 1,
      },
    ]);
    const invalidateQueries = vi.spyOn(view.client, 'invalidateQueries');
    await act(async () =>
      (view.container.querySelector('button[aria-label="重命名: 喜欢"]') as HTMLButtonElement).click(),
    );
    await act(async () =>
      updateInput(view.container.querySelector('input[aria-label="标签名称 (简体中文)"]') as HTMLInputElement, '最爱'),
    );
    await act(async () =>
      updateInput(
        view.container.querySelector('input[aria-label="标签名称 (English)"]') as HTMLInputElement,
        'Favorite',
      ),
    );
    await act(async () => (view.container.querySelector('li form button[type="submit"]') as HTMLButtonElement).click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    const editForm = view.container.querySelector('li form');
    const zhValue = editForm?.querySelector<HTMLInputElement>('input[aria-label="标签名称 (简体中文)"]')?.value;
    const enValue = editForm?.querySelector<HTMLInputElement>('input[aria-label="标签名称 (English)"]')?.value;
    view.cleanup();

    expect(mocks.renameUserTag).toHaveBeenCalledWith('tag-one', '最爱', 'zh-CN');
    expect(mocks.renameUserTag).toHaveBeenCalledWith('tag-one', 'Favorite', 'en-US');
    expect(mocks.toastError).toHaveBeenCalledWith('Error: patch failed');
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['library', 'tags'] });
    expect(mocks.toastSuccess).not.toHaveBeenCalled();

    // Still in edit mode with the user's input retained, matching the partially persisted state.
    expect(editForm).toBeTruthy();
    expect(zhValue).toBe('最爱');
    expect(enValue).toBe('Favorite');
  });

  it('rejects clearing an existing locale name with explicit validation', async () => {
    const view = await renderTagManagement([
      {
        id: 'tag-one',
        name: '喜欢',
        localizedNames: { 'zh-CN': '喜欢' },
        sourceLocale: 'zh-CN',
        userEditedLocales: ['zh-CN'],
        bookCount: 1,
      },
    ]);
    await act(async () =>
      (view.container.querySelector('button[aria-label="重命名: 喜欢"]') as HTMLButtonElement).click(),
    );
    const zhInput = view.container.querySelector('input[aria-label="标签名称 (简体中文)"]') as HTMLInputElement;
    await act(async () => updateInput(zhInput, ''));

    const save = view.container.querySelector('button[aria-label="保存"]') as HTMLButtonElement;
    const isSaveDisabled = save.disabled;
    await act(async () => save.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const editFormAfterSubmit = view.container.querySelector('li form');
    view.cleanup();

    expect(isSaveDisabled).toBe(false);
    expect(mocks.toastError).toHaveBeenCalledWith('请输入标签名称');
    expect(mocks.renameUserTag).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(editFormAfterSubmit).toBeTruthy();
  });

  it('leaves a missing locale empty without validation errors', async () => {
    const view = await renderTagManagement([
      {
        id: 'tag-one',
        name: '喜欢',
        localizedNames: { 'zh-CN': '喜欢' },
        sourceLocale: 'zh-CN',
        userEditedLocales: ['zh-CN'],
        bookCount: 1,
      },
    ]);
    await act(async () =>
      (view.container.querySelector('button[aria-label="重命名: 喜欢"]') as HTMLButtonElement).click(),
    );
    await act(async () =>
      updateInput(view.container.querySelector('input[aria-label="标签名称 (简体中文)"]') as HTMLInputElement, '最爱'),
    );
    await act(async () => (view.container.querySelector('li form button[type="submit"]') as HTMLButtonElement).click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(mocks.renameUserTag).toHaveBeenCalledTimes(1);
    expect(mocks.renameUserTag).toHaveBeenCalledWith('tag-one', '最爱', 'zh-CN');
    expect(mocks.renameUserTag).not.toHaveBeenCalledWith('tag-one', expect.anything(), 'en-US');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('标签已重命名');
    expect(mocks.toastError).not.toHaveBeenCalled();
    view.cleanup();
  });

  it('reports translation outcomes without claiming the tag was not saved', async () => {
    const view = await renderTagManagement([]);
    mocks.completeUserTagTranslations.mockRejectedValueOnce(new Error('network'));
    const createInput = view.container.querySelector('form input') as HTMLInputElement;
    await act(async () => updateInput(createInput, '以后再读'));
    const createButton = Array.from(view.container.querySelectorAll('button')).find(
      (button) => button.textContent === '创建标签',
    );
    await act(async () => createButton?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(mocks.toastSuccess).toHaveBeenCalledWith('标签已创建');
    expect(mocks.toastInfo).toHaveBeenCalledWith('多语言名称未补全');
    expect(mocks.toastError).not.toHaveBeenCalled();
    view.cleanup();
  });

  it('surfaces completed, missing, provider-unavailable, and failed manual translation feedback', async () => {
    const tag = {
      id: 'tag-one',
      name: '喜欢',
      localizedNames: { 'zh-CN': '喜欢' },
      sourceLocale: 'zh-CN',
      userEditedLocales: ['zh-CN'],
      bookCount: 1,
    };
    const infoCases = [
      { status: 'completed', info: '多语言名称已补全' },
      { status: 'incomplete', info: '多语言名称未补全' },
      { status: 'provider_unavailable', info: '多语言名称未补全；请配置可用的 AI Provider。' },
    ] as const;

    for (const infoCase of infoCases) {
      const view = await renderTagManagement([tag]);
      const complete = view.container.querySelector('button[aria-label="补全名称: 喜欢"]') as HTMLButtonElement;
      expect(complete).toBeTruthy();
      mocks.completeUserTagTranslations.mockResolvedValueOnce({ status: infoCase.status, tag });
      await act(async () => complete.click());
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(mocks.toastInfo).toHaveBeenCalledWith(infoCase.info);
      expect(mocks.toastError).not.toHaveBeenCalled();
      view.cleanup();
    }

    const failing = await renderTagManagement([tag]);
    const complete = failing.container.querySelector('button[aria-label="补全名称: 喜欢"]') as HTMLButtonElement;
    mocks.completeUserTagTranslations.mockRejectedValueOnce(new Error('x'));
    await act(async () => complete.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(mocks.toastError).toHaveBeenCalled();
    failing.cleanup();
  });

  it('opens a tag result from its name and count while preserving the return Library source', async () => {
    mocks.searchParams = new URLSearchParams({ returnTo: '/library?utm=keep&source=personal' });
    const view = await renderTagManagement([{ id: 'tag-one', name: '喜欢', bookCount: 2 }]);
    const tagLink = Array.from(view.container.querySelectorAll('a')).find((link) => link.textContent?.includes('喜欢'));

    expect(tagLink?.getAttribute('href')).toBe('/library?utm=keep&source=personal&tag=tag-one');
    expect(tagLink?.textContent).toContain('用于 2 本书');
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

  it('creates a tag and immediately associates it with a book', async () => {
    const view = await renderLibrary({
      isPending: false,
      isError: false,
      data: { current: null, items: [item('book', false)] },
    });
    await act(async () =>
      (view.container.querySelector('button[aria-label="管理《Book book》"]') as HTMLButtonElement).click(),
    );
    const manageItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find((element) =>
      element.textContent?.includes('管理标签'),
    );
    await act(async () => (manageItem as HTMLElement).click());

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const input = dialog.querySelector('input[aria-label="标签名称"]') as HTMLInputElement;
    await act(async () => updateInput(input, '新建并关联'));
    await act(async () => (dialog.querySelector('button[aria-label="创建标签"]') as HTMLButtonElement).click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(mocks.createUserTag).toHaveBeenCalledWith('新建并关联', 'zh-CN');
    expect(mocks.assignUserTag).toHaveBeenCalledWith('book', 'tag-new');
    view.cleanup();
  });

  it('syncs the selection after create-and-assign refreshes so a later save does not drop the new association', async () => {
    const tagOne = { id: 'tag-one', name: '喜欢', bookCount: 0 };
    mocks.useUserTagsQuery.mockReturnValue({ data: [tagOne] });
    const view = await renderLibrary({
      isPending: false,
      isError: false,
      data: { current: null, items: [item('book', false)] },
    });
    await act(async () =>
      (view.container.querySelector('button[aria-label="管理《Book book》"]') as HTMLButtonElement).click(),
    );
    const manageItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find((element) =>
      element.textContent?.includes('管理标签'),
    );
    await act(async () => (manageItem as HTMLElement).click());

    // The dialog refreshes tag views after the mutation; mirror the persisted outcome the
    // server would return: the new tag exists and is already associated with the book.
    vi.spyOn(view.client, 'invalidateQueries').mockImplementation(async () => {
      const created = { id: 'tag-new', name: '新建并关联', localizedNames: { 'zh-CN': '新建并关联' }, bookCount: 1 };
      mocks.useUserTagsQuery.mockReturnValue({ data: [tagOne, created] });
      mocks.useLibraryQuery.mockReturnValue({
        isPending: false,
        isError: false,
        data: {
          current: null,
          items: [{ ...item('book', false), userTags: [{ id: 'tag-new', name: '新建并关联' }] }],
        },
      });
    });

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const input = dialog.querySelector('input[aria-label="标签名称"]') as HTMLInputElement;
    await act(async () => updateInput(input, '新建并关联'));
    await act(async () => (dialog.querySelector('button[aria-label="创建标签"]') as HTMLButtonElement).click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(mocks.createUserTag).toHaveBeenCalledWith('新建并关联', 'zh-CN');
    expect(mocks.assignUserTag).toHaveBeenCalledWith('book', 'tag-new');

    // After the query refresh propagates, the new tag must render as selected.
    await view.rerender();
    const refreshedDialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const createdCheckbox = Array.from(refreshedDialog.querySelectorAll('label'))
      .find((label) => label.textContent?.includes('新建并关联'))
      ?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(createdCheckbox.checked).toBe(true);

    // Saving again is a no-op: it must not unassign the association just created.
    await act(async () =>
      Array.from(document.querySelectorAll('button'))
        .find((button) => button.textContent === '保存标签')
        ?.click(),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(mocks.assignUserTag).toHaveBeenCalledTimes(1);
    expect(mocks.unassignUserTag).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
    view.cleanup();
  });

  it('closes the tag dialog without sending requests when unsaved checkbox changes are cancelled', async () => {
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

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const checkboxes = Array.from(dialog.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    await act(async () => {
      checkboxes[0]?.click();
      checkboxes[1]?.click();
    });
    await act(async () =>
      Array.from(document.querySelectorAll('button'))
        .find((button) => button.textContent === '关闭')
        ?.click(),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(mocks.assignUserTag).not.toHaveBeenCalled();
    expect(mocks.unassignUserTag).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    view.cleanup();
  });

  it('keeps repeated saves idempotent after the refreshed associations reload', async () => {
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
    await act(async () => checkboxes[1]?.click());
    await act(async () =>
      Array.from(document.querySelectorAll('button'))
        .find((button) => button.textContent === '保存标签')
        ?.click(),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(mocks.assignUserTag).toHaveBeenCalledWith('book', 'tag-two');
    expect(mocks.unassignUserTag).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('标签已更新');

    // Reload the persisted state (tag-two now attached), reopen, and save with no changes.
    mocks.useUserTagsQuery.mockReturnValue({
      data: [
        { ...tags[0]!, bookCount: 1 },
        { ...tags[1]!, bookCount: 1 },
      ],
    });
    mocks.useLibraryQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        current: null,
        items: [
          {
            ...entry,
            userTags: [
              { id: 'tag-one', name: '喜欢' },
              { id: 'tag-two', name: '以后再读' },
            ],
          },
        ],
      },
    });
    await view.rerender();
    await act(async () =>
      (view.container.querySelector('button[aria-label="管理《Book book》"]') as HTMLButtonElement).click(),
    );
    const reopenItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find((element) =>
      element.textContent?.includes('管理标签'),
    );
    await act(async () => (reopenItem as HTMLElement).click());
    await act(async () =>
      Array.from(document.querySelectorAll('button'))
        .find((button) => button.textContent === '保存标签')
        ?.click(),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(mocks.assignUserTag).toHaveBeenCalledTimes(1);
    expect(mocks.unassignUserTag).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
    view.cleanup();
  });

  it('reports a failed save without success, refreshes to actual state, and allows recovery', async () => {
    const tags = [
      { id: 'tag-one', name: '喜欢', bookCount: 1 },
      { id: 'tag-two', name: '以后再读', bookCount: 0 },
    ];
    mocks.useUserTagsQuery.mockReturnValue({ data: tags });
    const entry = { ...item('book', false), userTags: [{ id: 'tag-one', name: '喜欢' }] };
    const view = await renderLibrary({ isPending: false, isError: false, data: { current: null, items: [entry] } });
    const invalidateQueries = vi.spyOn(view.client, 'invalidateQueries');
    mocks.assignUserTag.mockRejectedValueOnce(new Error('assignment failed'));
    await act(async () =>
      (view.container.querySelector('button[aria-label="管理《Book book》"]') as HTMLButtonElement).click(),
    );
    const manageItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find((element) =>
      element.textContent?.includes('管理标签'),
    );
    await act(async () => (manageItem as HTMLElement).click());

    const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    await act(async () => {
      checkboxes[0]?.click();
      checkboxes[1]?.click();
    });
    await act(async () =>
      Array.from(document.querySelectorAll('button'))
        .find((button) => button.textContent === '保存标签')
        ?.click(),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    // The whole save is not a success; the dialog stays open and refreshes to persisted state.
    expect(mocks.toastError).toHaveBeenCalledWith('Error: assignment failed');
    expect(mocks.toastSuccess).not.toHaveBeenCalledWith('标签已更新');
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['library'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['library', 'tags'] });
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();

    // Recovery: saving again retries the same pending diff and succeeds.
    await act(async () =>
      Array.from(document.querySelectorAll('button'))
        .find((button) => button.textContent === '保存标签')
        ?.click(),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(mocks.unassignUserTag).toHaveBeenCalledWith('book', 'tag-one');
    expect(mocks.assignUserTag).toHaveBeenCalledWith('book', 'tag-two');
    expect(mocks.assignUserTag).toHaveBeenCalledTimes(2);
    expect(mocks.toastSuccess).toHaveBeenCalledWith('标签已更新');
    view.cleanup();
  });

  it('holds tag-save feedback and the pending lock until every request has settled', async () => {
    const tags = [
      { id: 'tag-one', name: '喜欢', bookCount: 1 },
      { id: 'tag-two', name: '以后再读', bookCount: 0 },
    ];
    mocks.useUserTagsQuery.mockReturnValue({ data: tags });
    const entry = { ...item('book', false), userTags: [{ id: 'tag-one', name: '喜欢' }] };
    const view = await renderLibrary({ isPending: false, isError: false, data: { current: null, items: [entry] } });

    // The assign (add) request fails immediately while the unassign (remove) request
    // stays in flight and only succeeds later.
    const unassignDone = deferred();
    mocks.assignUserTag.mockImplementationOnce(() => Promise.reject(new Error('assign failed')));
    mocks.unassignUserTag.mockImplementationOnce(() => unassignDone.promise);

    await openTagAssignmentDialog(view);
    const checkboxes = dialogCheckboxes();
    expect(checkboxes.map((checkbox) => checkbox.checked)).toEqual([true, false]);
    await act(async () => {
      checkboxes[0]?.click();
      checkboxes[1]?.click();
    });
    const invalidateQueries = vi.spyOn(view.client, 'invalidateQueries');
    await act(async () => saveTagsButton()?.click());
    await flush();

    // While the slower request is unresolved, the save must stay pending and silent:
    // no final refresh, no feedback either way, and no second save can start.
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    const lockedSave = saveTagsButton();
    expect(lockedSave?.disabled).toBe(true);
    await act(async () => lockedSave?.click());
    await flush();
    expect(mocks.assignUserTag).toHaveBeenCalledTimes(1);
    expect(mocks.unassignUserTag).toHaveBeenCalledTimes(1);

    // Only after the slow request settles does the save finish, refresh, and report.
    unassignDone.resolve();
    await flush();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['library'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['library', 'tags'] });
    expect(mocks.toastError).toHaveBeenCalledWith('Error: assign failed');
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    view.cleanup();
  });

  it('waits for the slower tag request before refreshing, then retries only the missing change', async () => {
    const tags = [
      { id: 'tag-one', name: '喜欢', bookCount: 1 },
      { id: 'tag-two', name: '以后再读', bookCount: 0 },
    ];
    mocks.useUserTagsQuery.mockReturnValue({ data: tags });
    const entry = { ...item('book', false), userTags: [{ id: 'tag-one', name: '喜欢' }] };
    const view = await renderLibrary({ isPending: false, isError: false, data: { current: null, items: [entry] } });

    // Refresh returns the persisted state that is observable at refresh time: with the
    // unassign still in flight tag-one remains attached; once it settles, only tag-one
    // was removed (the assign failed), so the partial-success baseline is no tags.
    let isUnassignSettled = false;
    const invalidateQueries = vi.spyOn(view.client, 'invalidateQueries').mockImplementation(async () => {
      const persistedUserTags = isUnassignSettled ? [] : [{ id: 'tag-one', name: '喜欢' }];
      mocks.useLibraryQuery.mockReturnValue({
        isPending: false,
        isError: false,
        data: { current: null, items: [{ ...entry, userTags: persistedUserTags }] },
      });
      mocks.useUserTagsQuery.mockReturnValue({
        data: [{ ...tags[0]!, bookCount: isUnassignSettled ? 0 : 1 }, tags[1]!],
      });
    });
    const unassignDone = deferred();
    mocks.assignUserTag.mockImplementationOnce(() => Promise.reject(new Error('assign failed')));
    mocks.unassignUserTag.mockImplementationOnce(() => unassignDone.promise);

    await openTagAssignmentDialog(view);
    const checkboxes = dialogCheckboxes();
    await act(async () => {
      checkboxes[0]?.click();
      checkboxes[1]?.click();
    });
    await act(async () => saveTagsButton()?.click());
    await flush();

    isUnassignSettled = true;
    unassignDone.resolve();
    await flush();

    // The failed save reports only after every request finished: error feedback, no
    // success, refreshed queries, and the dialog stays open.
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['library'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['library', 'tags'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['book-detail', 'book'] });
    expect(mocks.toastError).toHaveBeenCalledWith('Error: assign failed');
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();

    // The refresh applied to the open dialog: the user's own selection is preserved.
    await view.rerender();
    const keptSelection = dialogCheckboxes();
    expect(keptSelection.map((checkbox) => checkbox.checked)).toEqual([false, true]);

    // Reopening the dialog exposes the refreshed persisted baseline: the unassign
    // succeeded (tag-one gone) and the assign never did (tag-two absent).
    await act(async () =>
      Array.from(document.querySelectorAll('button'))
        .find((button) => button.textContent === '关闭')
        ?.click(),
    );
    await openTagAssignmentDialog(view);
    const baselineCheckboxes = dialogCheckboxes();
    expect(baselineCheckboxes.map((checkbox) => checkbox.checked)).toEqual([false, false]);

    // Retrying against that baseline sends only the still-missing assign; the
    // already-successful unassign must not be re-sent.
    await act(async () => baselineCheckboxes[1]?.click());
    await act(async () => saveTagsButton()?.click());
    await flush();

    expect(mocks.unassignUserTag).toHaveBeenCalledTimes(1);
    expect(mocks.assignUserTag).toHaveBeenCalledTimes(2);
    expect(mocks.assignUserTag).toHaveBeenLastCalledWith('book', 'tag-two');
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).toHaveBeenCalledWith('标签已更新');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    view.cleanup();
  });

  it('reports an all-success tag save with success feedback and closes the dialog', async () => {
    const tags = [
      { id: 'tag-one', name: '喜欢', bookCount: 1 },
      { id: 'tag-two', name: '以后再读', bookCount: 0 },
    ];
    mocks.useUserTagsQuery.mockReturnValue({ data: tags });
    const entry = { ...item('book', false), userTags: [{ id: 'tag-one', name: '喜欢' }] };
    const view = await renderLibrary({ isPending: false, isError: false, data: { current: null, items: [entry] } });
    const invalidateQueries = vi.spyOn(view.client, 'invalidateQueries');
    await openTagAssignmentDialog(view);
    const checkboxes = dialogCheckboxes();
    await act(async () => {
      checkboxes[0]?.click();
      checkboxes[1]?.click();
    });
    await act(async () => saveTagsButton()?.click());
    await flush();

    expect(mocks.unassignUserTag).toHaveBeenCalledWith('book', 'tag-one');
    expect(mocks.assignUserTag).toHaveBeenCalledWith('book', 'tag-two');
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['library'] });
    expect(mocks.toastSuccess).toHaveBeenCalledWith('标签已更新');
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    view.cleanup();
  });

  it('reports an all-fail tag save with an error, no success, and an open dialog', async () => {
    const tags = [
      { id: 'tag-one', name: '喜欢', bookCount: 1 },
      { id: 'tag-two', name: '以后再读', bookCount: 0 },
    ];
    mocks.useUserTagsQuery.mockReturnValue({ data: tags });
    const entry = { ...item('book', false), userTags: [{ id: 'tag-one', name: '喜欢' }] };
    const view = await renderLibrary({ isPending: false, isError: false, data: { current: null, items: [entry] } });
    mocks.assignUserTag.mockRejectedValueOnce(new Error('assign failed'));
    mocks.unassignUserTag.mockRejectedValueOnce(new Error('unassign failed'));
    await openTagAssignmentDialog(view);
    const checkboxes = dialogCheckboxes();
    await act(async () => {
      checkboxes[0]?.click();
      checkboxes[1]?.click();
    });
    await act(async () => saveTagsButton()?.click());
    await flush();

    expect(mocks.assignUserTag).toHaveBeenCalledTimes(1);
    expect(mocks.unassignUserTag).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith('Error: assign failed');
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    view.cleanup();
  });

  it('keeps manual create-and-assign working when translation completion is unavailable', async () => {
    mocks.completeUserTagTranslations.mockResolvedValue({
      status: 'provider_unavailable',
      tag: { id: 'tag-new', name: '新建并关联' },
    });
    const view = await renderLibrary({
      isPending: false,
      isError: false,
      data: { current: null, items: [item('book', false)] },
    });
    await act(async () =>
      (view.container.querySelector('button[aria-label="管理《Book book》"]') as HTMLButtonElement).click(),
    );
    const manageItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find((element) =>
      element.textContent?.includes('管理标签'),
    );
    await act(async () => (manageItem as HTMLElement).click());

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    await act(async () =>
      updateInput(dialog.querySelector('input[aria-label="标签名称"]') as HTMLInputElement, '新建并关联'),
    );
    await act(async () => (dialog.querySelector('button[aria-label="创建标签"]') as HTMLButtonElement).click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(mocks.createUserTag).toHaveBeenCalledWith('新建并关联', 'zh-CN');
    expect(mocks.assignUserTag).toHaveBeenCalledWith('book', 'tag-new');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('标签已创建');
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.toastInfo).toHaveBeenCalledWith('多语言名称未补全；请配置可用的 AI Provider。');
    view.cleanup();
  });

  it('refreshes Library, tags, and detail after a partial tag-assignment failure', async () => {
    mocks.assignUserTag.mockRejectedValueOnce(new Error('assignment failed'));
    const view = await renderLibrary({
      isPending: false,
      isError: false,
      data: { current: null, items: [item('book', false)] },
    });
    const invalidateQueries = vi.spyOn(view.client, 'invalidateQueries');
    await act(async () =>
      (view.container.querySelector('button[aria-label="管理《Book book》"]') as HTMLButtonElement).click(),
    );
    const manageItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find((element) =>
      element.textContent?.includes('管理标签'),
    );
    await act(async () => (manageItem as HTMLElement).click());

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    await act(async () =>
      updateInput(dialog.querySelector('input[aria-label="标签名称"]') as HTMLInputElement, '稍后阅读'),
    );
    await act(async () => (dialog.querySelector('button[aria-label="创建标签"]') as HTMLButtonElement).click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(mocks.toastError).toHaveBeenCalledWith('Error: assignment failed');
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['library'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['library', 'tags'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['book-detail', 'book'] });
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
    expect(view.container.querySelector('a[href="/works/processing?returnTo=%2Flibrary"]')).toBeTruthy();
    expect(view.container.querySelector('a[href="/works/failed?returnTo=%2Flibrary"]')).toBeTruthy();
    expect(view.container.querySelector('a[href="/read/processing"]')).toBeNull();
    expect(view.container.querySelector('a[href="/read/failed"]')).toBeNull();
    expect(view.container.textContent).not.toContain('重试');
    expect(view.container.querySelectorAll('button[aria-label^="管理《"]')).toHaveLength(1);
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
      button.textContent?.includes('上传书籍'),
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
      button.textContent?.includes('上传书籍'),
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
    expect(document.body.textContent).not.toContain('编辑书籍信息');
    expect(document.body.textContent).not.toContain('删除书籍');
    expect(removeMenuItem).toBeTruthy();
    await act(async () => (removeMenuItem as HTMLElement).click());
    expect(document.body.textContent).toContain('此书将从书库移除，阅读进度和历史记录会保留。');
    const confirm = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '移出书库');
    const invalidateQueries = vi.spyOn(view.client, 'invalidateQueries');
    await act(async () => confirm?.click());
    expect(mocks.removeFromLibrary).toHaveBeenCalledWith('catalog');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('已移出书库');
    // Removal also drops the Save Intent, so Discover must re-read both the
    // records projection and the owner-scoped save status.
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['library'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['discover', 'records'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['discover', 'save-status'] });
    view.cleanup();
  });

  it('offers owner edit/delete actions for Personal Works and deletes failed uploads', async () => {
    const view = await renderLibrary({
      isPending: false,
      isError: false,
      data: { current: null, items: [item('personal', false)] },
    });
    const menuTrigger = view.container.querySelector('button[aria-label="管理《Book personal》"]') as HTMLButtonElement;
    await act(async () => menuTrigger.click());
    const menuText = document.body.textContent ?? '';
    expect(menuText).toContain('编辑书籍信息');
    expect(menuText).toContain('删除书籍');
    expect(menuText).not.toContain('移出书库');
    const edit = Array.from(document.querySelectorAll('[role="menuitem"]')).find((element) =>
      element.textContent?.includes('编辑书籍信息'),
    );
    await act(async () => (edit as HTMLElement).click());
    expect(document.body.textContent).toContain('书名');
    const inputs = document.querySelectorAll('input');
    await act(async () => {
      updateInput(inputs[0] as HTMLInputElement, 'New title');
      updateInput(inputs[1] as HTMLInputElement, 'New author');
      const submit = Array.from(document.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('保存更改'),
      );
      submit?.click();
    });
    expect(mocks.updatePersonalWork).toHaveBeenCalledWith(
      'personal',
      expect.objectContaining({ title: 'New title', author: 'New author' }),
    );
    view.cleanup();

    const failedView = await renderLibrary({
      isPending: false,
      isError: false,
      data: { current: null, items: [item('failed', false, 'failed')] },
    });
    await act(async () =>
      (failedView.container.querySelector('button[aria-label="管理《Book failed》"]') as HTMLButtonElement).click(),
    );
    const failedMenu = document.body.textContent ?? '';
    expect(failedMenu).toContain('删除书籍');
    expect(failedMenu).not.toContain('编辑书籍信息');
    const deleteItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find((element) =>
      element.textContent?.includes('删除书籍'),
    );
    await act(async () => (deleteItem as HTMLElement).click());
    expect(document.body.textContent).toContain('《Book failed》及其阅读进度、对话和存储文件将被永久删除。');
    const confirm = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '删除书籍');
    await act(async () => confirm?.click());
    expect(mocks.deletePersonalWork).toHaveBeenCalledWith('failed');
    failedView.cleanup();
  });

  it('restores source and tag filters from the URL and normalizes invalid parameters', async () => {
    const favorite = { id: 'tag-favorite', name: '喜欢', bookCount: 1 };
    mocks.useUserTagsQuery.mockReturnValue({ data: [favorite] });
    const data = {
      current: null,
      items: [
        item('personal-english', false),
        { ...item('saved-favorite', true), userTags: [{ id: 'tag-favorite', name: '喜欢' }] },
      ],
    } as unknown as LibraryData;

    mocks.searchParams = new URLSearchParams('source=saved&tag=tag-favorite');
    const restored = await renderLibrary({ isPending: false, isError: false, data });
    expect(
      restored.container.querySelector(
        'a[href="/works/saved-favorite?returnTo=%2Flibrary%3Fsource%3Dsaved%26tag%3Dtag-favorite"]',
      ),
    ).toBeTruthy();
    expect(restored.container.querySelector('a[href="/works/personal-english?returnTo=%2Flibrary"]')).toBeNull();
    expect(mocks.navigateReplace).not.toHaveBeenCalled();
    restored.cleanup();

    mocks.searchParams = new URLSearchParams('source=bogus&tag=missing');
    const invalid = await renderLibrary({ isPending: false, isError: false, data });
    expect(invalid.container.querySelector('a[href="/works/personal-english?returnTo=%2Flibrary"]')).toBeTruthy();
    expect(invalid.container.querySelector('a[href="/works/saved-favorite?returnTo=%2Flibrary"]')).toBeTruthy();
    expect(mocks.navigateReplace).toHaveBeenCalledWith('/library', { scroll: false });
    invalid.cleanup();
  });

  it('persists source and tag selections in the URL', async () => {
    const favorite = { id: 'tag-favorite', name: '喜欢', bookCount: 1 };
    mocks.useUserTagsQuery.mockReturnValue({ data: [favorite] });
    const data = {
      current: null,
      items: [{ ...item('saved-favorite', true), userTags: [{ id: 'tag-favorite', name: '喜欢' }] }],
    } as unknown as LibraryData;
    mocks.searchParams = new URLSearchParams('utm=keep');
    const view = await renderLibrary({ isPending: false, isError: false, data });

    await act(async () => buttonByLabel(view.container, '我的上传')?.click());
    expect(mocks.navigatePush).toHaveBeenCalledWith('/library?utm=keep&source=personal', { scroll: false });

    await act(async () => tagButton(view.container, '喜欢')?.click());
    expect(mocks.navigatePush).toHaveBeenCalledWith('/library?utm=keep&source=personal&tag=tag-favorite', {
      scroll: false,
    });
    view.cleanup();
  });

  it('restores filters when the URL changes through browser history', async () => {
    const favorite = { id: 'tag-favorite', name: '喜欢', bookCount: 1 };
    mocks.useUserTagsQuery.mockReturnValue({ data: [favorite] });
    const data = {
      current: null,
      items: [
        item('personal', false),
        { ...item('saved-favorite', true), userTags: [{ id: 'tag-favorite', name: '喜欢' }] },
      ],
    } as unknown as LibraryData;
    const view = await renderLibrary({ isPending: false, isError: false, data });
    expect(view.container.querySelector('a[href="/works/personal?returnTo=%2Flibrary"]')).toBeTruthy();

    await view.navigate('?source=saved&tag=tag-favorite');
    expect(
      view.container.querySelector(
        'a[href="/works/saved-favorite?returnTo=%2Flibrary%3Fsource%3Dsaved%26tag%3Dtag-favorite"]',
      ),
    ).toBeTruthy();
    expect(view.container.querySelector('a[href="/works/personal?returnTo=%2Flibrary"]')).toBeNull();

    await view.navigate('');
    expect(view.container.querySelector('a[href="/works/personal?returnTo=%2Flibrary"]')).toBeTruthy();
    view.cleanup();
  });

  it('opens the mobile category drawer, selects a source, and closes it', async () => {
    const data = {
      current: null,
      items: [item('personal', false), item('saved', true)],
    } as unknown as LibraryData;
    const view = await renderLibrary({ isPending: false, isError: false, data });

    const trigger = view.container.querySelector('button[aria-haspopup="dialog"]') as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    await act(async () => trigger.click());
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const sheet = document.querySelector('[data-slot="sheet-content"]') as HTMLElement;
    expect(sheet).toBeTruthy();
    expect(sheet.textContent).toContain('我的上传');

    await act(async () => (buttonByLabel(sheet, '我的上传') as HTMLButtonElement).click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(
      view.container.querySelector('a[href="/works/personal?returnTo=%2Flibrary%3Fsource%3Dpersonal"]'),
    ).toBeTruthy();
    expect(view.container.querySelector('a[href="/works/saved?returnTo=%2Flibrary"]')).toBeNull();
    view.cleanup();
  });

  it('creates a tag from the Library source navigation', async () => {
    const view = await renderLibrary({
      isPending: false,
      isError: false,
      data: { current: null, items: [item('book', false)] },
    });
    await act(async () => buttonByLabel(view.container, '新建标签')?.click());
    const input = view.container.querySelector('input[aria-label="标签名称"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    await act(async () => updateInput(input, '科幻'));
    await act(async () => buttonByLabel(view.container, '创建标签')?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(mocks.createUserTag).toHaveBeenCalledWith('科幻', 'zh-CN');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('标签已创建');
    view.cleanup();
  });

  it('keeps tag creation and management discoverable without redundant empty-state copy', async () => {
    const view = await renderLibrary({
      isPending: false,
      isError: false,
      data: { current: null, items: [item('book', false)] },
    });

    expect(view.container.textContent).not.toContain('用标签整理你的书库');
    expect(buttonByLabel(view.container, '新建标签')).toBeTruthy();
    expect(view.container.querySelector('a[aria-label="管理标签"]')).toBeTruthy();
    view.cleanup();
  });

  it('explains empty source categories and offers a route back to all books', async () => {
    const savedEmpty = await renderLibrary({
      isPending: false,
      isError: false,
      data: { current: null, items: [item('personal', false)] },
    });
    await savedEmpty.navigate('?source=saved');
    expect(savedEmpty.container.textContent).toContain('还没有已保存的书');
    expect(savedEmpty.container.textContent).not.toContain('没有符合条件的书');
    await act(async () => buttonByLabel(savedEmpty.container, '查看全部书籍')?.click());
    expect(mocks.navigatePush).toHaveBeenCalledWith('/library', { scroll: false });
    savedEmpty.cleanup();

    const personalEmpty = await renderLibrary({
      isPending: false,
      isError: false,
      data: { current: null, items: [item('saved', true)] },
    });
    await personalEmpty.navigate('?source=personal');
    expect(personalEmpty.container.textContent).toContain('还没有上传的书');
    expect(buttonByLabel(personalEmpty.container, '查看全部书籍')).toBeTruthy();
    personalEmpty.cleanup();
  });

  it('renders the new shortcut and empty-source copy in English', async () => {
    const english = await renderLibrary(
      {
        isPending: false,
        isError: false,
        data: {
          current: { work: work('current'), state: { status: 'in_progress', currentPartId: null, progressRatio: 0 } },
          items: [item('personal', false)],
        } as unknown as LibraryData,
      },
      'en-US',
    );
    await english.navigate('?source=saved');

    const continueHero = Array.from(english.container.querySelectorAll('section')).find((section) =>
      section.textContent?.includes('Continue reading'),
    );
    expect(continueHero?.textContent).toContain('Reading');
    expect(continueHero?.textContent).not.toContain('0% read');
    expect(english.container.textContent).toContain('No saved books yet');
    expect(buttonByLabel(english.container, 'View all books')).toBeTruthy();
    expect(english.container.textContent).not.toContain('Use tags to organize your library');
    expect(buttonByLabel(english.container, 'New tag')).toBeTruthy();
    expect(english.container.querySelector('a[aria-label="Manage tags"]')).toBeTruthy();
    english.cleanup();
  });

  it('distinguishes a filtered empty result and warns only about a server-truncated Library', async () => {
    const favorite = { id: 'tag-favorite', name: '喜欢', bookCount: 0 };
    mocks.useUserTagsQuery.mockReturnValue({ data: [favorite] });

    const small = await renderLibrary({
      isPending: false,
      isError: false,
      data: { current: null, items: [item('personal', false)] },
    });
    await small.navigate('?tag=tag-favorite');
    expect(small.container.textContent).toContain('当前分类下没有匹配的书籍');
    expect(buttonByLabel(small.container, '清除筛选')).toBeTruthy();
    expect(buttonByLabel(small.container, '查看全部书籍')).toBeFalsy();
    small.cleanup();

    // A full 48-item page with isTruncated=false is authoritative: the empty
    // filter result must not claim that the loaded books were cut off.
    const complete = await renderLibrary({
      isPending: false,
      isError: false,
      data: {
        current: null,
        items: Array.from({ length: 48 }, (_, index) => item(`book-${index}`, false)),
        isTruncated: false,
      },
    });
    await complete.navigate('?source=saved');
    expect(complete.container.textContent).toContain('还没有已保存的书');
    expect(complete.container.textContent).not.toContain('当前已加载的书籍中没有符合条件的结果');
    expect(complete.container.textContent).not.toContain('书库仅显示前 48 本书');
    await complete.navigate('?tag=tag-favorite');
    expect(complete.container.textContent).toContain('当前分类下没有匹配的书籍');
    expect(complete.container.textContent).not.toContain('当前已加载的书籍中没有符合条件的结果');
    complete.cleanup();

    // Only the server may declare truncation.
    const capped = await renderLibrary({
      isPending: false,
      isError: false,
      data: {
        current: null,
        items: Array.from({ length: 48 }, (_, index) => item(`book-${index}`, false)),
        isTruncated: true,
      },
    });
    await capped.navigate('?source=saved');
    expect(capped.container.textContent).toContain('当前已加载的书籍中没有符合条件的结果');
    expect(capped.container.textContent).not.toContain('还没有已保存的书');
    expect(capped.container.textContent).toContain('书库仅显示前 48 本书');

    await capped.navigate('?tag=tag-favorite');
    expect(capped.container.textContent).toContain('当前已加载的书籍中没有符合条件的结果');
    capped.cleanup();
  });
});
