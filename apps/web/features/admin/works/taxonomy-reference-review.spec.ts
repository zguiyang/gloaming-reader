// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it } from 'vitest';

import type { SourceReference, TaxonomyReference } from '@gloaming/shared/taxonomy';

import { LocaleProvider } from '@/lib/locale-context';

import { SourceReferenceReview, TaxonomyReferenceReview } from './taxonomy-reference-review';

function ref(
  id: string,
  names: TaxonomyReference['names'],
  origin: TaxonomyReference['origin'] = 'manual',
): TaxonomyReference {
  return { id, names, origin };
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('TaxonomyReferenceReview', () => {
  it('renders bilingual admin review rows with index, origin, and missing translation labels', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const items = [
      ref('tag-science', { 'zh-CN': '科学', 'en-US': 'Science' }),
      ref('tag-fantasy', { 'en-US': 'Fantasy' }, 'ai'),
    ];

    await act(async () => {
      root.render(
        // eslint-disable-next-line react/no-children-prop
        createElement(LocaleProvider, {
          locale: 'zh-CN',
          children: createElement(TaxonomyReferenceReview, { items }),
        }),
      );
    });

    expect(container.textContent).toContain('科学');
    expect(container.textContent).toContain('Science');
    expect(container.textContent).toContain('Fantasy');
    expect(container.textContent).toContain('缺失中文');
    expect(container.textContent).toContain('完整');
    expect(container.textContent).toContain('部分');
    expect(container.textContent).toContain('AI 生成');
    expect(container.textContent).toMatch(/1/);
    expect(container.textContent).toMatch(/2/);
  });

  it('shows not-filled when there are no taxonomy references', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        // eslint-disable-next-line react/no-children-prop
        createElement(LocaleProvider, {
          locale: 'en-US',
          children: createElement(TaxonomyReferenceReview, { items: [] }),
        }),
      );
    });

    expect(container.textContent).toContain('Not filled');
  });
});

describe('SourceReferenceReview', () => {
  it('renders source names as a single raw-name column', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const items: SourceReference[] = [{ id: 'source-1', name: 'Project Gutenberg', origin: 'extracted' }];

    await act(async () => {
      root.render(
        // eslint-disable-next-line react/no-children-prop
        createElement(LocaleProvider, {
          locale: 'zh-CN',
          children: createElement(SourceReferenceReview, { items }),
        }),
      );
    });

    expect(container.textContent).toContain('Project Gutenberg');
    expect(container.textContent).not.toContain('翻译状态');
    expect(container.querySelectorAll('th')).toHaveLength(2);

    void act(() => {
      root.unmount();
    });
    container.remove();
  });
});
