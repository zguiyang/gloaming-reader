// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { ReaderPart } from '@/features/reader/reader-part';
import { LocaleProvider } from '@/lib/locale-context';

describe('ReaderPart keyboard selection', () => {
  it('opens the selection actions on Shift release for a selection inside the article', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSelectText = vi.fn();
    await act(async () =>
      root.render(
        // LocaleProvider's props type requires children here.
        // eslint-disable-next-line react/no-children-prop
        createElement(LocaleProvider, {
          locale: 'en-US',
          children: createElement(ReaderPart, {
            partId: 'part',
            html: '<p data-p="1">A sealed packet arrived.</p>',
            fontSize: 'md',
            aiDrawerOpen: false,
            onSelectText,
            onCenterTap: vi.fn(),
            onScroll: vi.fn(),
          }),
        }),
      ),
    );
    const article = container.querySelector('article')!;
    const paragraph = document.createElement('p');
    paragraph.setAttribute('data-p', '1');
    paragraph.textContent = 'A sealed packet arrived.';
    article.appendChild(paragraph);
    const node = paragraph.firstChild!;
    const rect = { top: 10, left: 20, bottom: 30, right: 80, width: 60, height: 20 };
    const getSelection = vi.spyOn(window, 'getSelection').mockReturnValue({
      anchorNode: node,
      focusNode: node,
      rangeCount: 1,
      toString: () => 'sealed packet',
      getRangeAt: () => ({ getBoundingClientRect: () => rect }),
    } as unknown as Selection);
    expect(article.tabIndex).toBe(0);
    await act(async () =>
      article.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true, bubbles: true })),
    );
    expect(onSelectText).not.toHaveBeenCalled();
    await act(async () => article.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true })));
    expect(onSelectText).toHaveBeenCalledWith(
      expect.objectContaining({ quote: 'sealed packet', paragraphId: 'part-p2', rect }),
    );
    onSelectText.mockClear();
    getSelection.mockReturnValue({
      anchorNode: document.body,
      focusNode: node,
      rangeCount: 1,
      toString: () => 'outside text',
      getRangeAt: () => ({ getBoundingClientRect: () => rect }),
    } as unknown as Selection);
    await act(async () => article.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true })));
    expect(onSelectText).not.toHaveBeenCalled();
    getSelection.mockRestore();
    await act(async () => root.unmount());
    container.remove();
  });
});
