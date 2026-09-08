import { describe, expect, it } from 'vitest';

import { coverTintForVolume, VOLUME_COVER_TINTS } from '@/features/work-cover/work-cover-tint';

describe('coverTintForVolume', () => {
  it('picks a stable tint from the VOLUME_COVER_TINTS set', () => {
    const tint = coverTintForVolume(['story'], 'Ocean Tales');
    expect(VOLUME_COVER_TINTS).toContain(tint);
    expect(coverTintForVolume(['story'], 'Ocean Tales')).toBe(tint);
  });
});
