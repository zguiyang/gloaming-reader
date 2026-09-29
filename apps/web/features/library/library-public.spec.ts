import { describe, expect, it } from 'vitest';

import type { LibraryData, LibraryItem } from '@gloaming/shared/library';

import { buildLibraryItemMap } from '@/features/library/library-public';

describe('buildLibraryItemMap', () => {
  it('indexes independent Continue Reading and Library members by work id', () => {
    const current = { work: { id: 'current-work' }, state: {} } as NonNullable<LibraryData['current']>;
    const item = { work: { id: 'library-work' }, state: null } as LibraryItem;
    const map = buildLibraryItemMap({ current, items: [item] } as LibraryData);

    expect(map.has('current-work')).toBe(false);
    expect(map.get('library-work')).toBe(item);
  });
});
