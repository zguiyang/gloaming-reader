import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WorkCover, type WorkCoverProps } from '@/features/work-cover/work-cover';

function renderCover(props: WorkCoverProps): string {
  return renderToStaticMarkup(createElement(WorkCover, props));
}

describe('WorkCover appearances', () => {
  it('standard without image shows official badge, spine, fallback title, and className', () => {
    const html = renderCover({
      title: 'Ocean Tales',
      tags: ['story'],
      appearance: 'standard',
      className: 'aspect-[2/3] w-48',
    });

    expect(html).toContain('官方');
    expect(html).toContain('Ocean Tales');
    expect(html).toContain('w-1.5');
    expect(html).toContain('rounded-l-md');
    expect(html).toContain('hover:scale-[1.015]');
    expect(html).toContain('aspect-[2/3]');
    expect(html).toContain('w-48');
    expect(html).not.toContain('<img');
  });

  it('compact without image keeps compact structure and ignores className / official badge', () => {
    const html = renderCover({
      title: 'Ocean Tales',
      appearance: 'compact',
      className: 'aspect-[2/3] w-48',
    });

    expect(html).toContain('Ocean Tales');
    expect(html).toContain('h-20');
    expect(html).toContain('w-14');
    expect(html).toContain('rounded-sm');
    expect(html).toContain('line-clamp-4');
    expect(html).not.toContain('官方');
    expect(html).not.toContain('w-1.5');
    expect(html).not.toContain('hover:scale-[1.015]');
    expect(html).not.toContain('aspect-[2/3]');
    expect(html).not.toContain('w-48');
    expect(html).not.toContain('<img');
  });

  it('standard with image renders the cover URL and omits fallback chrome', () => {
    const html = renderCover({
      title: 'Ocean Tales',
      tags: ['story'],
      coverImageUrl: '/api/assets/cover-1',
      appearance: 'standard',
    });

    expect(html).toContain('src="/api/assets/cover-1"');
    expect(html).toContain('opacity-95');
    expect(html).toContain('w-1.5');
    expect(html).not.toContain('官方');
    expect(html).not.toContain('Ocean Tales');
  });

  it('compact with image renders the cover URL without standard-only chrome', () => {
    const html = renderCover({
      title: 'Ocean Tales',
      coverImageUrl: '/api/assets/cover-2',
      appearance: 'compact',
    });

    expect(html).toContain('src="/api/assets/cover-2"');
    expect(html).toContain('h-20');
    expect(html).toContain('w-14');
    expect(html).not.toContain('官方');
    expect(html).not.toContain('w-1.5');
    expect(html).not.toContain('hover:scale-[1.015]');
    expect(html).not.toContain('opacity-95');
    expect(html).not.toContain('Ocean Tales');
  });
});
