import { describe, expect, it } from 'vitest';

import { contentAssetTrackSchema } from '@gloaming/shared/content-assets';

import { type AssetRow, toTrack, wordTimingsFromTimeline } from '@/domains/assets/content/track-view';

function readyAsset(overrides: Partial<AssetRow> = {}): AssetRow {
  const now = new Date('2026-09-10T00:00:00.000Z');
  return {
    id: 'asset-1',
    workId: 'work-1',
    partId: 'part-1',
    kind: 'audio_us',
    status: 'ready',
    storageKey: 'part-audio/p1/audio_us/h/chapter.mp3',
    mimeType: 'audio/mpeg',
    contentHash: 'hash-1',
    generationKey: 'part-1:audio_us:hash-1',
    generationToken: null,
    generationClaimedAt: null,
    generationLeaseExpiresAt: null,
    meta: {
      voice: 'en-US-JennyNeural',
      durationMs: 500,
      generatedAt: '2026-09-10T00:00:00.000Z',
      objectKeys: ['part-audio/p1/audio_us/h/chapter.mp3'],
      timeline: [
        {
          index: 0,
          textHash: 'seg',
          startMs: 0,
          durationMs: 500,
          wordTimings: [
            { text: 'Hello', audioOffsetMs: 0, durationMs: 120, textOffset: 0 },
            { text: 'amp;', audioOffsetMs: 120, durationMs: 80, textOffset: -1 },
          ],
        },
      ],
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('toTrack', () => {
  it('keeps playable audio when historical word timings include invalid rows', () => {
    const track = toTrack('us', 'hash-1', readyAsset());
    expect(track.audioAvailable).toBe(true);
    expect(track.audioUrl).toBe('/api/assets/asset-1');
    expect(track.durationMs).toBe(500);
    expect(track.timeline?.[0]?.wordTimings).toEqual([
      { text: 'Hello', audioOffsetMs: 0, durationMs: 120, textOffset: 0 },
    ]);
    expect(() => contentAssetTrackSchema.parse(track)).not.toThrow();
  });

  it('preserves valid timeline output unchanged', () => {
    const asset = readyAsset({
      meta: {
        voice: 'en-US-JennyNeural',
        durationMs: 200,
        timeline: [
          {
            index: 0,
            textHash: 'seg',
            startMs: 0,
            durationMs: 200,
            wordTimings: [{ text: 'Hi', audioOffsetMs: 10.2, durationMs: 90.7, textOffset: 0 }],
          },
        ],
      },
    });
    const track = toTrack('us', 'hash-1', asset);
    expect(track.timeline?.[0]?.wordTimings).toEqual([
      { text: 'Hi', audioOffsetMs: 10, durationMs: 91, textOffset: 0 },
    ]);
  });
});

describe('wordTimingsFromTimeline', () => {
  it('flattens only valid word timings', () => {
    expect(
      wordTimingsFromTimeline([
        {
          index: 0,
          textHash: 'a',
          startMs: 0,
          durationMs: 100,
          wordTimings: [
            { text: 'a', audioOffsetMs: 0, durationMs: 50, textOffset: 0 },
            { text: 'bad', audioOffsetMs: 50, durationMs: 50, textOffset: -1 },
          ],
        },
      ]),
    ).toEqual([{ text: 'a', audioOffsetMs: 0, durationMs: 50, textOffset: 0 }]);
  });
});
