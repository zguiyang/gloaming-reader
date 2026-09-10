import { describe, expect, it } from 'vitest';

import { collectAudioObjectKeys } from '@/modules/content-assets/service';

describe('collectAudioObjectKeys', () => {
  it('collects storageKey, objectKeys, and timeline keys without duplicates', () => {
    expect(
      collectAudioObjectKeys({
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
      collectAudioObjectKeys({
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
      collectAudioObjectKeys({
        storageKey: 'part-audio/p1/audio_us/h/chapter.mp3',
        meta: { objectKeys: [] },
      }),
    ).toEqual(['part-audio/p1/audio_us/h/chapter.mp3']);
  });

  it('collects objectKeys and timeline when storageKey is null', () => {
    expect(
      collectAudioObjectKeys({
        storageKey: null,
        meta: {
          objectKeys: ['part-audio/p1/audio_us/h/seg/0000.mp3'],
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

  it('ignores timing-only timeline segments without storageKey', () => {
    expect(
      collectAudioObjectKeys({
        storageKey: 'part-audio/p1/audio_us/h/chapter.mp3',
        meta: {
          objectKeys: ['part-audio/p1/audio_us/h/chapter.mp3'],
          // Compatible with generation that no longer writes timeline.storageKey.
          timeline: [
            {
              index: 0,
              textHash: 't0',
              startMs: 0,
              durationMs: 1000,
              wordTimings: [],
            },
          ] as {
            index: number;
            textHash: string;
            startMs: number;
            durationMs: number;
            storageKey?: string;
            wordTimings: [];
          }[],
        },
      }),
    ).toEqual(['part-audio/p1/audio_us/h/chapter.mp3']);
  });
});
