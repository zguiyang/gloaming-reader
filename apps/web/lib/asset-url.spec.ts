import { describe, expect, it } from 'vitest';

import { coverUrlFromAssetId } from '@/lib/asset-url';

describe('coverUrlFromAssetId', () => {
  it('builds encoded asset URLs and handles missing assets', () => {
    expect(coverUrlFromAssetId('cover/one')).toBe('/api/assets/cover%2Fone');
    expect(coverUrlFromAssetId(null)).toBeNull();
  });
});
