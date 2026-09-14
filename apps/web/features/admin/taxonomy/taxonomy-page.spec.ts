// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { TaxonomyItemResult, TaxonomyKind } from '@gloaming/shared/taxonomy';

import { LocaleProvider } from '@/lib/locale-context';

import { TaxonomyPage } from './taxonomy-page';

function itemForKind(kind: TaxonomyKind): TaxonomyItemResult {
  if (kind === 'source') {
    return {
      id: 'source-1',
      name: 'Source A',
      origin: 'manual',
      usage: 0,
      matchRule: 'example.org',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };
  }
  const names = kind === 'tag' ? { 'zh-CN': '标签甲', 'en-US': 'Tag A' } : { 'zh-CN': '分类甲', 'en-US': 'Category A' };

  return {
    id: `${kind}-1`,
    names,
    origin: 'manual',
    usage: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
}

vi.mock('@/features/admin/taxonomy/taxonomy-api', () => ({
  useTaxonomyQuery: (kind: TaxonomyKind) => ({
    data: [itemForKind(kind)],
    isPending: false,
  }),
  useCreateTaxonomy: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateTaxonomy: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteTaxonomy: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCleanupTaxonomy: () => ({ mutateAsync: vi.fn(), isPending: false }),
  formatTaxonomyApiError: (error: unknown) => String(error),
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('TaxonomyPage', () => {
  it('renders tag, category, and source tabs with bilingual table cells and row index', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      // eslint-disable-next-line react/no-children-prop
      root.render(createElement(LocaleProvider, { locale: 'zh-CN', children: createElement(TaxonomyPage) }));
    });

    expect(container.textContent).toContain('标签');
    expect(container.textContent).toContain('分类');
    expect(container.textContent).toContain('来源');
    expect(container.textContent).toContain('标签甲');
    expect(container.textContent).toContain('Tag A');
    expect(container.textContent).toContain('完整');
    expect(container.textContent).toMatch(/1/);

    const categoryTab = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('分类'),
    );
    expect(categoryTab).toBeTruthy();
    await act(async () => {
      categoryTab?.click();
    });

    expect(container.textContent).toContain('分类甲');
    expect(container.textContent).toContain('Category A');

    const sourceTab = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('来源'),
    );
    expect(sourceTab).toBeTruthy();
    await act(async () => {
      sourceTab?.click();
    });

    expect(container.textContent).toContain('Source A');

    void act(() => {
      root.unmount();
    });
    container.remove();
  });
});
