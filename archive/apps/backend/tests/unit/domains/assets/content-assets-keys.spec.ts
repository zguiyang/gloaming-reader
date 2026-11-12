import { describe, expect, it } from 'vitest';

import { collectFormalKeysFromContentAssetRow } from '@/domains/assets/management/referenced-keys';

describe('collectFormalKeysFromContentAssetRow', () => {
  it('collects the storage key plus every objectKey, deduplicated', () => {
    expect(
      collectFormalKeysFromContentAssetRow({
        storageKey: 'book-images/p1/a.webp',
        kind: 'image',
        meta: { objectKeys: ['book-images/p1/a.webp', 'book-images/p1/a-thumb.webp'] },
      }),
    ).toEqual(['book-images/p1/a.webp', 'book-images/p1/a-thumb.webp']);
  });

  it('keeps objectKeys for non-audio kinds', () => {
    expect(
      collectFormalKeysFromContentAssetRow({
        storageKey: 'covers/p1/cover.jpg',
        kind: 'cover',
        meta: { objectKeys: ['covers/p1/cover.jpg'] },
      }),
    ).toEqual(['covers/p1/cover.jpg']);
  });
});
