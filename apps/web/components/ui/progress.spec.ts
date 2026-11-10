import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LoadingOverlay } from '@/components/loading-overlay';
import { PaginationLink } from '@/components/ui/pagination';
import { Progress } from '@/components/ui/progress';

describe('shared loading and progress controls', () => {
  it('exposes the supplied progress value', () => {
    const html = renderToStaticMarkup(createElement(Progress, { value: 80, 'aria-label': 'Progress' }));
    expect(html).toContain('aria-valuenow="80"');
    expect(html).toContain('width:80%');
  });

  it('keeps covered controls out of the keyboard order only while loading', () => {
    const child = createElement('button', null, 'Open');
    // React's component props require children in the props object.
    // eslint-disable-next-line react/no-children-prop
    const active = renderToStaticMarkup(createElement(LoadingOverlay, { active: true, children: child }));
    // eslint-disable-next-line react/no-children-prop
    const inactive = renderToStaticMarkup(createElement(LoadingOverlay, { active: false, children: child }));
    expect(active).toContain('inert=""');
    expect(inactive).not.toContain('inert=""');
  });

  it('removes a disabled pagination link from the keyboard order', () => {
    const html = renderToStaticMarkup(createElement(PaginationLink, { href: '#', 'aria-disabled': true }));
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('tabindex="-1"');
  });
});
