import { describe, expect, it } from 'vitest';

import {
  collectFormalKeysFromContentAssetRow,
  collectLegacySegmentKeysFromContentAssetRow,
} from '@/domains/assets/management/referenced-keys';

describe('collectFormalKeysFromContentAssetRow (legacy audio-kind rows)', () => {
  it('returns only chapter and non-segment objectKeys from legacy metadata', () => {
    expect(
      collectFormalKeysFromContentAssetRow({
        storageKey: 'part-audio/p1/audio_us/h/chapter.mp3',
        kind: 'audio_us',
        meta: {
          objectKeys: [
            'part-audio/p1/audio_us/h/chapter.mp3',
            'part-audio/p1/audio_us/h/seg/0000.mp3',
            'part-audio/p1/audio_us/h/seg/0001.mp3',
          ],
          timeline: [
            {
              index: 0,
              textHash: 't0',
              startMs: 0,
              durationMs: 1000,
              storageKey: 'part-audio/p1/audio_us/h/seg/0000.mp3',
              wordTimings: [],
            },
          ],
        },
      }),
    ).toEqual(['part-audio/p1/audio_us/h/chapter.mp3']);
  });

  it('keeps non-segment objectKeys for non-audio kinds', () => {
    expect(
      collectFormalKeysFromContentAssetRow({
        storageKey: 'book-images/p1/a.webp',
        kind: 'image',
        meta: { objectKeys: ['book-images/p1/a.webp'] },
      }),
    ).toEqual(['book-images/p1/a.webp', 'book-images/p1/a.webp']);
  });
});

describe('collectLegacySegmentKeysFromContentAssetRow', () => {
  it('collects segment keys from objectKeys and timeline only', () => {
    expect(
      collectLegacySegmentKeysFromContentAssetRow({
        meta: {
          objectKeys: ['part-audio/p1/audio_us/h/chapter.mp3', 'part-audio/p1/audio_us/h/seg/0000.mp3'],
          timeline: [
            {
              index: 0,
              textHash: 't0',
              startMs: 0,
              durationMs: 1000,
              storageKey: 'part-audio/p1/audio_us/h/seg/0001.mp3',
              wordTimings: [],
            },
          ],
        },
      }).toSorted(),
    ).toEqual(['part-audio/p1/audio_us/h/seg/0000.mp3', 'part-audio/p1/audio_us/h/seg/0001.mp3']);
  });
});
