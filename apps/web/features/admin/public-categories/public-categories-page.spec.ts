// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PublicCategoryManagementItem } from '@gloaming/shared/discovery';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

vi.mock('@/lib/api-request', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, apiRequest: mocks.apiRequest };
});

import { LocaleProvider } from '@/lib/locale-context';

import { PublicCategoriesPage } from './public-categories-page';

function category(input: { id: string; localizedNames: Record<string, string> }): PublicCategoryManagementItem {
  return {
    id: input.id,
    createdBy: 'manual',
    sourceLocale: 'zh-CN',
    meaning: null,
    manualLocales: ['zh-CN'],
    aliases: [],
    recordCount: 2,
    localizedNames: input.localizedNames,
    missingLocales: [],
  };
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.apiRequest.mockImplementation((path: string) => {
    if (path.includes('/category-shelves')) {
      return Promise.resolve({ items: [] });
    }
    return Promise.resolve([category({ id: 'cat-1', localizedNames: { 'zh-CN': '小说', 'en-US': 'Fiction' } })]);
  });
});

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
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

  const cleanup = () => {
    void act(() => root.unmount());
    container.remove();
  };
  renderedRoots.push(cleanup);
  return { container, cleanup };
}

describe('PublicCategoriesPage', () => {
  it('loads categories and shelf list without legacy mapping or translation controls', async () => {
    const view = await renderPage();
    expect(view.container.textContent).toContain('公共分类');
    expect(view.container.textContent).toContain('小说');
    const categoryButton = Array.from(view.container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('小说'),
    );
    expect(categoryButton).toBeTruthy();
    await act(async () => categoryButton!.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(mocks.apiRequest.mock.calls.some((call) => String(call[0]).includes('/category-shelves'))).toBe(true);
    expect(mocks.apiRequest.mock.calls.some((call) => String(call[0]).includes('/translations/complete'))).toBe(false);
    view.cleanup();
  });
});
