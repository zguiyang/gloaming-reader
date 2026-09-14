// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { TaxonomyItem } from '@gloaming/shared/taxonomy';

import { LocaleProvider } from '@/lib/locale-context';

import { TaxonomyMultiPicker, TaxonomySelect } from './taxonomy-picker';

const tagItems: TaxonomyItem[] = [
  {
    id: 'tag-science',
    names: { 'zh-CN': '科学', 'en-US': 'Science' },
    origin: 'manual',
    usage: 1,
    matchRule: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
  {
    id: 'tag-fantasy',
    names: { 'en-US': 'Fantasy' },
    origin: 'ai',
    usage: 0,
    matchRule: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
];

const categoryItems: TaxonomyItem[] = [
  {
    id: 'cat-fiction',
    names: { 'zh-CN': '小说', 'en-US': 'Fiction' },
    origin: 'manual',
    usage: 3,
    matchRule: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
];

vi.mock('@/features/admin/taxonomy/taxonomy-api', () => ({
  useTaxonomyQuery: (kind: string) => ({
    data: kind === 'category' ? categoryItems : tagItems,
    isPending: false,
  }),
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function renderWithLocale() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  return {
    container,
    async render(next: ReturnType<typeof createElement>) {
      await act(async () => {
        // eslint-disable-next-line react/no-children-prop
        root.render(createElement(LocaleProvider, { locale: 'zh-CN', children: next }));
      });
    },
    cleanup() {
      void act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe('TaxonomyMultiPicker', () => {
  it('keeps stable id selection and shows locale-primary label after locale switch', async () => {
    const view = renderWithLocale();
    const onChange = vi.fn();
    await view.render(
      createElement(TaxonomyMultiPicker, {
        kind: 'tag',
        value: ['tag-science'],
        onChange,
        placeholder: '选择标签',
      }),
    );

    expect(view.container.textContent).toContain('科学');
    expect(view.container.textContent).not.toContain('tag-science');

    const enView = renderWithLocale();
    await enView.render(
      // eslint-disable-next-line react/no-children-prop
      createElement(LocaleProvider, {
        locale: 'en-US',
        children: createElement(TaxonomyMultiPicker, {
          kind: 'tag',
          value: ['tag-science'],
          onChange,
          placeholder: 'Select tags',
        }),
      }),
    );

    expect(enView.container.textContent).toContain('Science');
    expect(enView.container.textContent).not.toContain('科学');
    enView.cleanup();
    view.cleanup();
  });
});

describe('TaxonomySelect', () => {
  it('selects category by id and shows bilingual option labels in zh-CN', async () => {
    const view = renderWithLocale();
    let current: string | null = null;
    const onChange = vi.fn((next: string | null) => {
      current = next;
    });

    await view.render(
      createElement(TaxonomySelect, {
        value: current,
        onChange,
        allowClear: true,
      }),
    );

    const trigger = view.container.querySelector('button');
    expect(trigger).toBeTruthy();
    await act(async () => {
      trigger?.click();
    });

    expect(document.body.textContent).toContain('小说');
    expect(document.body.textContent).toContain('Fiction');

    const option = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('小说'),
    );
    expect(option).toBeTruthy();
    await act(async () => {
      option?.click();
    });

    expect(onChange).toHaveBeenCalledWith('cat-fiction');
    view.cleanup();
  });
});
