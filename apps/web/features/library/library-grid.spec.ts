// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it } from 'vitest';

import type { LibraryItem, UserTagManagementItem } from '@gloaming/shared/library';

import { LocaleProvider } from '@/lib/locale-context';

import { LibraryGrid } from './library-grid';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function item(id: string, title: string, kind: 'personal' | 'saved_catalog', author = ''): LibraryItem {
  return {
    work: { id, title, description: '', coverAssetId: null, publishedAt: null },
    state: null,
    availability: 'ready',
    libraryItemKind: kind,
    personalMetadata: kind === 'personal' ? { author } : null,
    canRemoveFromLibrary: kind === 'saved_catalog',
    userTags: [],
  } as LibraryItem;
}

async function renderGrid(items: LibraryItem[]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        // eslint-disable-next-line react/no-children-prop
        createElement(LocaleProvider, {
          locale: 'en-US',
          children: createElement(LibraryGrid, { items, tags: [] as UserTagManagementItem[] }),
        }),
      ),
    ),
  );
  return {
    container,
    cleanup() {
      void act(() => root.unmount());
      container.remove();
    },
  };
}

describe('LibraryGrid same-title context', () => {
  it('disambiguates same-title cards with trustworthy origin/author facts only', async () => {
    const view = await renderGrid([
      item('personal-1', 'Walden', 'personal', 'Henry David Thoreau'),
      item('saved-1', 'walden', 'saved_catalog'),
    ]);
    const cardFor = (id: string) =>
      Array.from(view.container.querySelectorAll('article')).find((article) =>
        article.querySelector(`a[href="/works/${id}?returnTo=%2Flibrary"]`),
      );

    expect(cardFor('personal-1')?.textContent).toContain('My uploads · Henry David Thoreau');
    // Saved Catalog items project no author; only the origin kind may show.
    expect(cardFor('saved-1')?.textContent).toContain('Saved');
    expect(cardFor('saved-1')?.textContent).not.toContain('My uploads');
    // No raw IDs leak into the visible context.
    expect(cardFor('personal-1')?.textContent).not.toContain('personal-1');

    view.cleanup();
  });

  it('adds no context line when titles are unique in the rendered list', async () => {
    const view = await renderGrid([
      item('walden', 'Walden', 'personal', 'Henry David Thoreau'),
      item('emma', 'Emma', 'personal', 'Jane Austen'),
    ]);
    const contextLine = Array.from(view.container.querySelectorAll('article p')).find((p) =>
      p.textContent?.includes('My uploads'),
    );

    expect(contextLine).toBeUndefined();

    view.cleanup();
  });
});
