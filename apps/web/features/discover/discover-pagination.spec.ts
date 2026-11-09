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

async function renderPagination(props: { page: number; hasMore: boolean; locale?: 'en-US' | 'zh-CN' }) {
  const onPageChange = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const localeProviderProps: Parameters<typeof LocaleProvider>[0] = {
    locale: props.locale ?? 'en-US',
    children: createElement(DiscoverPagination, {
      page: props.page,
      hasMore: props.hasMore,
      onPageChange,
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
    cleanup() {
      act(() => root.unmount());
      container.remove();
      queryClient.clear();
    },
  };
}

describe('DiscoverPagination hasMore controls', () => {
  it('hides when there is only one page of results', async () => {
    const view = await renderPagination({ page: 1, hasMore: false });
    expect(view.container.querySelector('nav')).toBeNull();
    view.cleanup();
  });

  it('disables previous on the first page and advances with next', async () => {
    const view = await renderPagination({ page: 1, hasMore: true });
    const mobileNav = view.container.querySelector('nav.md\\:hidden')!;
    const buttons = Array.from(mobileNav.querySelectorAll('button'));
    expect(buttons[0]?.disabled).toBe(true);
    expect(buttons[1]?.disabled).toBe(false);
    expect(mobileNav.textContent).toContain('Page 1');
    await act(async () => buttons[1]!.click());
    expect(view.onPageChange).toHaveBeenCalledWith(2);
    view.cleanup();
  });

  it('disables next when hasMore is false and goes back with previous', async () => {
    const view = await renderPagination({ page: 3, hasMore: false });
    const mobileNav = view.container.querySelector('nav.md\\:hidden')!;
    const buttons = Array.from(mobileNav.querySelectorAll('button'));
    expect(buttons[0]?.disabled).toBe(false);
    expect(buttons[1]?.disabled).toBe(true);
    expect(mobileNav.textContent).toContain('Page 3');
    await act(async () => buttons[0]!.click());
    expect(view.onPageChange).toHaveBeenCalledWith(2);
    view.cleanup();
  });

  it('does not render per-page number jump controls', async () => {
    const view = await renderPagination({ page: 2, hasMore: true });
    const numberButtons = Array.from(view.container.querySelectorAll('button')).filter((button) =>
      /^\d+$/.test(button.textContent?.trim() ?? ''),
    );
    expect(numberButtons).toHaveLength(0);
    expect(view.container.textContent).not.toContain('4216');
    view.cleanup();
  });

  it('localizes the current page label', async () => {
    const view = await renderPagination({ page: 4, hasMore: true, locale: 'zh-CN' });
    expect(view.container.textContent).toContain('第 4 页');
    view.cleanup();
  });
});
