import { describe, expect, it } from 'vitest';

import type { ShelfData, ShelfItem } from '@gloaming/shared/shelf';

import { buildShelfItemMap, coverUrlFromAssetId } from '@/features/works-http';

describe('works-http read-model mappings', () => {
  it('indexes current and shelf items by work id', () => {
    const current = { work: { id: 'current-work' } } as ShelfItem;
    const item = { work: { id: 'shelf-work' } } as ShelfItem;
    const map = buildShelfItemMap({ current, items: [item] } as ShelfData);

    expect(map.get('current-work')).toBe(current);
    expect(map.get('shelf-work')).toBe(item);
  });

  it('builds encoded asset URLs and handles missing assets', () => {
    expect(coverUrlFromAssetId('cover/one')).toBe('/api/assets/cover%2Fone');
    expect(coverUrlFromAssetId(null)).toBeNull();
  });
});
