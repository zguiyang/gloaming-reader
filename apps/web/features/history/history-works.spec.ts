// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ReadingHistoryWork } from '@gloaming/shared/reading-history';

import { LocaleProvider } from '@/lib/locale-context';

import { HistoryWorks } from './history-works';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function work(id: string, status: ReadingHistoryWork['status'], date: string): ReadingHistoryWork {
  return { workId: id, title: `Book ${id}`, author: '', coverAssetId: null, status, date };
}

async function renderHistoryWorks(works: ReadingHistoryWork[]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      // eslint-disable-next-line react/no-children-prop
      createElement(LocaleProvider, { locale: 'zh-CN', children: createElement(HistoryWorks, { works }) }),
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

describe('HistoryWorks status projection', () => {
  it('projects in_progress and completed Reading State status to the existing History copy', async () => {
    // History rows carry no progressRatio: the Reading State status alone decides the label,
    // so an in_progress Work reads as in progress regardless of progress (e.g. 0% in Library).
    const view = await renderHistoryWorks([
      work('reading', 'in_progress', '2026-09-01'),
      work('finished', 'completed', '2026-08-18'),
    ]);
    const rowFor = (id: string) =>
      view.container.querySelector(`a[href="/read/${id}"]`)?.closest('li')?.textContent ?? '';

    expect(rowFor('reading')).toContain('正在阅读');
    expect(rowFor('reading')).not.toContain('已读完');
    expect(rowFor('finished')).toContain('已读完');
    expect(rowFor('finished')).not.toContain('正在阅读');

    view.cleanup();
  });
});
