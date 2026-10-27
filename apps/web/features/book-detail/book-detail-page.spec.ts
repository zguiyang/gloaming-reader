// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { BookDetailPage } from './book-detail-page';

vi.mock('@/lib/locale-context', () => ({ useLocale: () => ({ locale: 'zh-CN' }) }));

describe('BookDetailPage source record', () => {
  it('uses the detail page shell while exposing only source actions', () => {
    const html = renderToStaticMarkup(
      createElement(BookDetailPage, {
        returnTo: '/discover',
        source: {
          title: 'A source book',
          author: 'An author',
          coverImageUrl: null,
          description: null,
          actions: createElement('button', { type: 'button' }, '加入书库'),
        },
      }),
    );
    expect(html).toContain('A source book');
    expect(html).toContain('An author');
    expect(html).toContain('加入书库');
    expect(html).toContain('href="/discover"');
    expect(html).not.toContain('继续阅读');
    expect(html).not.toContain('/read/');
  });
});
