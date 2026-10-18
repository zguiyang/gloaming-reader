// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/lib/locale-context';

import { DiscoverPagination } from './discover-pagination';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const DOTS = '…';

async function renderPagination(props: {
  page: number;
  totalPages: number;
  hasMoreMobile?: boolean;
  locale?: 'en-US' | 'zh-CN';
}) {
  const onPageChange = vi.fn();
  const onLoadMore = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const localeProviderProps: Parameters<typeof LocaleProvider>[0] = {
    locale: props.locale ?? 'en-US',
    children: createElement(DiscoverPagination, {
      page: props.page,
      totalPages: props.totalPages,
      onPageChange,
      hasMoreMobile: props.hasMoreMobile ?? false,
      onLoadMore,
    }),
  };
  let root!: ReturnType<typeof createRoot>;
  await act(async () => {
    root = createRoot(container);
    root.render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(LocaleProvider, localeProviderProps)),
    );
  });
  return {
    container,
    onPageChange,
    onLoadMore,
    /** Desktop page-number window: buttons plus non-interactive ellipsis gaps. */
    pageButtons(): HTMLElement[] {
      const nav = container.querySelector('nav');
      const numbers = nav?.querySelector('div');
      return numbers ? (Array.from(numbers.children) as HTMLElement[]) : [];
    },
    cleanup() {
      act(() => root.unmount());
      container.remove();
      queryClient.clear();
    },
  };
}

/** Window entries in DOM order, with the ellipsis marker for gap entries. */
function pageButtonLabels(view: Awaited<ReturnType<typeof renderPagination>>): string[] {
  return view.pageButtons().map((entry) => entry.textContent?.trim() ?? '');
}

function pageNumberButtons(view: Awaited<ReturnType<typeof renderPagination>>): HTMLButtonElement[] {
  return view.pageButtons().filter((entry): entry is HTMLButtonElement => entry.tagName === 'BUTTON');
}

describe('DiscoverPagination bounded page numbers', () => {
  it('caps the number of page buttons across first, middle, and last pages of 4216 pages', async () => {
    for (const page of [1, 2108, 4216]) {
      const view = await renderPagination({ page, totalPages: 4216 });
      const buttons = view.pageButtons();
      expect(buttons.length).toBeLessThanOrEqual(9);
      const labels = pageButtonLabels(view);
      expect(labels).toContain(String(page));
      expect(labels[0]).toBe('1');
      expect(labels[labels.length - 1]).toBe('4216');
      view.cleanup();
    }
  });

  it('shows non-interactive ellipsis gaps between windowed pages', async () => {
    const view = await renderPagination({ page: 2108, totalPages: 4216 });
    const labels = pageButtonLabels(view);
    expect(labels.filter((label) => label === DOTS)).toHaveLength(2);
    for (const dots of view.pageButtons().filter((entry) => entry.tagName !== 'BUTTON')) {
      expect(dots.textContent?.trim()).toBe(DOTS);
      expect(dots.getAttribute('aria-hidden')).toBe('true');
    }
    view.cleanup();
  });

  it('keeps adjacent pages next to the current page', async () => {
    const view = await renderPagination({ page: 2108, totalPages: 4216 });
    const labels = pageButtonLabels(view);
    expect(labels).toContain('2107');
    expect(labels).toContain('2109');
    view.cleanup();
  });

  it('renders every page number once for a small page count', async () => {
    const view = await renderPagination({ page: 2, totalPages: 5 });
    expect(pageButtonLabels(view)).toEqual(['1', '2', '3', '4', '5']);
    expect(pageButtonLabels(view).filter((label) => label === DOTS)).toHaveLength(0);
    view.cleanup();
  });

  it('invokes onPageChange with the target page and marks the current page', async () => {
    const view = await renderPagination({ page: 3, totalPages: 5 });
    const buttons = pageNumberButtons(view);
    const five = buttons.find((button) => button.textContent?.trim() === '5')!;
    await act(async () => {
      five.click();
    });
    expect(view.onPageChange).toHaveBeenCalledWith(5);
    const current = buttons.find((button) => button.getAttribute('aria-current') === 'page');
    expect(current?.textContent?.trim()).toBe('3');
    view.cleanup();
  });

  it('keeps the mobile load-more control', async () => {
    const view = await renderPagination({ page: 1, totalPages: 4216, hasMoreMobile: true });
    const loadMore = Array.from(view.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Load more',
    );
    expect(loadMore).toBeDefined();
    await act(async () => {
      loadMore!.click();
    });
    expect(view.onLoadMore).toHaveBeenCalledTimes(1);
    view.cleanup();
  });
});
