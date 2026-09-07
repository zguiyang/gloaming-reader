import { describe, expect, it } from 'vitest';

import { SHELF_ITEMS_LIMIT, shelfDataSchema } from './shelf.ts';

describe('shelf api contracts', () => {
  it('accepts empty and populated shelf payloads', () => {
    expect(shelfDataSchema.parse({ current: null, items: [] })).toEqual({ current: null, items: [] });
    const populated = shelfDataSchema.parse({
      current: {
        work: {
          id: 'w1',
          title: 'Ocean Quiet',
          description: '',
          tags: ['science'],
          coverAssetId: null,
          publishedAt: '2026-08-21T00:00:00.000Z',
        },
        state: {
          status: 'in_progress',
          currentPartId: 'p1',
          progressRatio: 40,
          completedThroughSortOrder: 0,
          totalPartCount: 3,
          lastReadAt: '2026-08-21T00:00:00.000Z',
          completedAt: null,
        },
      },
      items: [],
    });
    expect(populated.current?.work.id).toBe('w1');
    expect(SHELF_ITEMS_LIMIT).toBe(48);
  });
});
