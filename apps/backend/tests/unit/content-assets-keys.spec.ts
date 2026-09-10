import { describe, expect, it } from 'vitest';

import {
  allAudioObjectKeysForLegacyCleanup,
  collectAudioObjectKeys,
  collectLegacyAudioSegmentKeysFromAsset,
  formalAudioObjectKeys,
} from '@/modules/content-assets/service';

describe('formalAudioObjectKeys', () => {
  it('returns only chapter and non-segment objectKeys from legacy metadata', () => {
    expect(
      formalAudioObjectKeys({
        storageKey: 'part-audio/p1/audio_us/h/chapter.mp3',
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
});

describe('allAudioObjectKeysForLegacyCleanup', () => {
  it('collects storageKey, objectKeys, and timeline keys without duplicates', () => {
    expect(
      allAudioObjectKeysForLegacyCleanup({
        storageKey: 'part-audio/p1/audio_us/h/chapter.mp3',
        meta: {
          objectKeys: ['part-audio/p1/audio_us/h/seg/0000.mp3', 'part-audio/p1/audio_us/h/chapter.mp3', ''],
          timeline: [
            {
              index: 0,
              textHash: 't0',
              startMs: 0,
              durationMs: 1000,
              storageKey: 'part-audio/p1/audio_us/h/seg/0000.mp3',
              wordTimings: [],
            },
            {
              index: 1,
              textHash: 't1',
              startMs: 1000,
              durationMs: 800,
              storageKey: 'part-audio/p1/audio_us/h/seg/0001.mp3',
              wordTimings: [],
            },
          ],
        },
      }).toSorted(),
    ).toEqual([
      'part-audio/p1/audio_us/h/chapter.mp3',
      'part-audio/p1/audio_us/h/seg/0000.mp3',
      'part-audio/p1/audio_us/h/seg/0001.mp3',
    ]);
  });

  it('returns a timeline segment key that is absent from objectKeys and storageKey', () => {
    expect(
      allAudioObjectKeysForLegacyCleanup({
        storageKey: 'part-audio/p1/audio_us/old/chapter.mp3',
        meta: {
          objectKeys: ['part-audio/p1/audio_us/old/chapter.mp3'],
          timeline: [
            {
              index: 0,
              textHash: 'legacy',
              startMs: 0,
              durationMs: 1200,
              storageKey: 'part-audio/p1/audio_us/old/seg/0000.mp3',
              wordTimings: [],
            },
          ],
        },
      }).toSorted(),
    ).toEqual(['part-audio/p1/audio_us/old/chapter.mp3', 'part-audio/p1/audio_us/old/seg/0000.mp3']);
  });

  it('handles empty objectKeys and a missing timeline', () => {
    expect(
      allAudioObjectKeysForLegacyCleanup({
        storageKey: 'part-audio/p1/audio_us/h/chapter.mp3',
        meta: { objectKeys: [] },
      }),
    ).toEqual(['part-audio/p1/audio_us/h/chapter.mp3']);
  });
});

describe('collectLegacyAudioSegmentKeysFromAsset', () => {
  it('collects segment keys from objectKeys and timeline only', () => {
    expect(
      collectLegacyAudioSegmentKeysFromAsset({
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

describe('collectAudioObjectKeys (legacy alias)', () => {
  it('delegates to allAudioObjectKeysForLegacyCleanup', () => {
    const asset = {
      storageKey: 'part-audio/p1/audio_us/h/chapter.mp3',
      meta: {
        objectKeys: ['part-audio/p1/audio_us/h/seg/0000.mp3'],
        timeline: [] as [],
      },
    };
    expect(collectAudioObjectKeys(asset)).toEqual(allAudioObjectKeysForLegacyCleanup(asset));
  });
});
