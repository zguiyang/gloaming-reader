// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PublicCategoryManagementItem } from '@gloaming/shared/discovery';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock('@/lib/api-request', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, apiRequest: mocks.apiRequest };
});

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError, info: mocks.toastInfo },
}));

import { LocaleProvider } from '@/lib/locale-context';

import { PublicCategoriesPage } from './public-categories-page';

const COMPLETE_PATH_SUFFIX = '/translations/complete';

function category(input: {
  id: string;
  localizedNames: Record<string, string>;
  missingLocales: string[];
}): PublicCategoryManagementItem {
  return {
    createdBy: 'manual',
    sourceLocale: 'zh-CN',
    meaning: null,
    manualLocales: ['zh-CN'],
    aliases: [],
    recordCount: 3,
    ...input,
  };
}

/** Server-provided gap: only zh-CN is stored, so en-US still needs completion. */
function missingCategory() {
  return category({
    id: 'cat-missing',
    localizedNames: { 'zh-CN': '科幻小说' },
    missingLocales: ['en-US'],
  });
}

/** Fully localized category: the completion action must stay disabled. */
function completeCategory() {
  return category({
    id: 'cat-complete',
    localizedNames: { 'zh-CN': '童话语言', 'en-US': 'Fairy Tale Language' },
    missingLocales: [],
  });
}

let categories: PublicCategoryManagementItem[] = [];
let completeHandler: () => Promise<unknown> = () => Promise.resolve({ translatedLocales: ['en-US'] });

function isCompletionRequest(path: string, options?: { method?: string }): boolean {
  return options?.method === 'POST' && path.endsWith(COMPLETE_PATH_SUFFIX);
}

function completionRequests(): unknown[][] {
  return mocks.apiRequest.mock.calls.filter((call) => isCompletionRequest(call[0], call[1]));
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.clearAllMocks();
  categories = [missingCategory(), completeCategory()];
  completeHandler = () => Promise.resolve({ translatedLocales: ['en-US'] });
  mocks.apiRequest.mockImplementation((path: string, options?: { method?: string }) => {
    if (isCompletionRequest(path, options)) {
      return completeHandler();
    }
    return Promise.resolve(categories);
  });
});

// Safety net: a failing assertion skips the test's own cleanup and would leak the root.
const renderedRoots: Array<() => void> = [];

afterEach(() => {
  while (renderedRoots.length) renderedRoots.pop()?.();
});

function withProviders(node: ReactElement, client: QueryClient) {
  return createElement(
    QueryClientProvider,
    { client },
    // eslint-disable-next-line react/no-children-prop
    createElement(LocaleProvider, { locale: 'zh-CN', children: node }),
  );
}

async function renderPage() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => root.render(withProviders(createElement(PublicCategoriesPage), client)));
  // Let the category list query settle so rows render instead of skeletons.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

  let isCleaned = false;
  const cleanup = () => {
    if (isCleaned) return;
    isCleaned = true;
    void act(() => root.unmount());
    container.remove();
  };
  renderedRoots.push(cleanup);

  return { container, cleanup };
}

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

/** The per-row completion controls, identified by their visible label. */
function completionButtons(container: ParentNode): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button')).filter((button) => button.textContent?.includes('补齐翻译'));
}

function buttonByAriaLabel(container: ParentNode, label: string): HTMLButtonElement {
  const button = completionButtons(container).find((candidate) => candidate.getAttribute('aria-label') === label);
  expect(button).toBeTruthy();
  return button!;
}

const MISSING_LABEL = '补齐 科幻小说 的缺失翻译';
const COMPLETE_LABEL = '补齐 童话语言 的缺失翻译';

describe('PublicCategoriesPage translation completion', () => {
  it('enables the action only for categories with a missing locale and never calls the backend on its own', async () => {
    const view = await renderPage();

    expect(completionButtons(view.container)).toHaveLength(2);
    expect(buttonByAriaLabel(view.container, MISSING_LABEL).disabled).toBe(false);
    expect(buttonByAriaLabel(view.container, COMPLETE_LABEL).disabled).toBe(true);

    await flush();
    // No automatic/bulk completion: only the list read has happened so far.
    expect(completionRequests()).toHaveLength(0);
    view.cleanup();
  });

  it('requests exactly one category, shows pending state, and toasts the filled locales', async () => {
    const view = await renderPage();
    let settle!: (value: unknown) => void;
    completeHandler = () => new Promise((resolve) => (settle = resolve));

    const button = buttonByAriaLabel(view.container, MISSING_LABEL);
    await act(async () => button.click());
    await flush();

    const requests = completionRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0][0]).toBe('/api/admin/discovery/categories/cat-missing/translations/complete');
    // Loading: the action is disabled while the pass runs.
    expect(buttonByAriaLabel(view.container, MISSING_LABEL).disabled).toBe(true);
    expect(buttonByAriaLabel(view.container, COMPLETE_LABEL).disabled).toBe(true);

    await act(async () => settle({ translatedLocales: ['en-US'] }));
    await flush();

    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess.mock.calls[0][0]).toContain('已补齐');
    expect(mocks.toastSuccess.mock.calls[0][0]).toContain('English');
    expect(mocks.toastError).not.toHaveBeenCalled();
    view.cleanup();
  });

  it('surfaces a failed completion as an error toast and keeps the action available', async () => {
    const view = await renderPage();
    completeHandler = () => Promise.reject(new Error('boom'));

    await act(async () => buttonByAriaLabel(view.container, MISSING_LABEL).click());
    await flush();

    expect(completionRequests()).toHaveLength(1);
    expect(mocks.toastError).toHaveBeenCalledWith('boom');
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(buttonByAriaLabel(view.container, MISSING_LABEL).disabled).toBe(false);
    view.cleanup();
  });

  it('reports an empty completion as a no-op instead of a filled-locales toast', async () => {
    const view = await renderPage();
    completeHandler = () => Promise.resolve({ translatedLocales: [] });

    await act(async () => buttonByAriaLabel(view.container, MISSING_LABEL).click());
    await flush();

    expect(mocks.toastInfo).toHaveBeenCalledWith('没有需要补齐的翻译。');
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
    view.cleanup();
  });
});
