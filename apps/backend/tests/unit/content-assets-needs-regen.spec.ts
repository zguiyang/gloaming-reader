import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { needsRegen } from '@/modules/content-assets/service';
import * as ossModule from '@/modules/oss';

vi.mock('@/db', () => ({
  db: {
    select: vi.fn(),
  },
}));

import { db } from '@/db';

function mockReadyAsset(overrides: Record<string, unknown> = {}) {
  const asset = {
    id: 'asset_1',
    status: 'ready',
    contentHash: 'hash_current',
    generationKey: null,
    generationLeaseExpiresAt: null,
    storageKey: 'part-audio/p1/audio_us/hash_current/chapter.mp3',
    meta: {
      objectKeys: [
        'part-audio/p1/audio_us/hash_current/chapter.mp3',
        'part-audio/p1/audio_us/hash_current/seg/0000.mp3',
      ],
      timeline: [
        {
          index: 0,
          textHash: 't0',
          startMs: 0,
          durationMs: 1000,
          storageKey: 'part-audio/p1/audio_us/hash_current/seg/0000.mp3',
          wordTimings: [],
        },
      ],
    },
    ...overrides,
  };
  const limit = vi.fn().mockResolvedValue([asset]);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  vi.mocked(db.select).mockReturnValue({ from } as never);
  return asset;
}

describe('needsRegen chapter-only formal checks', () => {
  let objectExistsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    objectExistsSpy = vi.spyOn(ossModule, 'objectExists');
  });

  afterEach(() => {
    objectExistsSpy.mockRestore();
  });

  it('does not require legacy segment objects when chapter exists', async () => {
    mockReadyAsset();
    objectExistsSpy.mockImplementation(async (key: string) => key.endsWith('/chapter.mp3'));

    await expect(needsRegen('p1', 'us', 'hash_current')).resolves.toBe(false);
    expect(objectExistsSpy).toHaveBeenCalledTimes(1);
    expect(objectExistsSpy).toHaveBeenCalledWith('part-audio/p1/audio_us/hash_current/chapter.mp3');
  });

  it('returns true when chapter object is missing', async () => {
    mockReadyAsset();
    objectExistsSpy.mockResolvedValue(false);

    await expect(needsRegen('p1', 'us', 'hash_current')).resolves.toBe(true);
  });
});
