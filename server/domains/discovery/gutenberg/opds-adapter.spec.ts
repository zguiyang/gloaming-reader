import { describe, expect, it } from 'vitest';

import { opdsPageWindow } from '@/server/domains/discovery/gutenberg/opds-adapter';
import { PROJECT_GUTENBERG_OPDS_PAGE_SIZE } from '@/server/domains/discovery/gutenberg/constants';

/**
 * The stride used to be hard-coded to `PROJECT_GUTENBERG_OPDS_PAGE_SIZE` (25)
 * while the response was sliced to the caller's smaller `pageSize`, so a 15-item
 * page fetched 1..15 then 26..40 and items 16..25 were unreachable.
 */
describe('opdsPageWindow', () => {
  it('produces contiguous, non-overlapping windows for the caller page size', () => {
    const pageSize = 15;
    const seen: number[] = [];
    for (let page = 1; page <= 4; page += 1) {
      const window = opdsPageWindow(page, pageSize);
      expect(window.pageSize).toBe(pageSize);
      for (let offset = 0; offset < pageSize; offset += 1) {
        seen.push(window.startIndex + offset);
      }
    }
    expect(seen).toEqual(Array.from({ length: 60 }, (_, index) => index + 1));
  });

  it('clamps the page size to the feed window', () => {
    expect(opdsPageWindow(2, 10_000)).toEqual({
      page: 2,
      pageSize: PROJECT_GUTENBERG_OPDS_PAGE_SIZE,
      startIndex: PROJECT_GUTENBERG_OPDS_PAGE_SIZE + 1,
    });
  });

  it('normalizes invalid page numbers', () => {
    expect(opdsPageWindow(0, 10)).toEqual({ page: 1, pageSize: 10, startIndex: 1 });
    expect(opdsPageWindow(-5, 0)).toEqual({ page: 1, pageSize: 1, startIndex: 1 });
  });
});
