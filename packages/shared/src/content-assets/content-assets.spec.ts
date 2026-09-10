import { describe, expect, it } from 'vitest';

import {
  audioTimelineSegmentSchema,
  buildContentAssetGenerationKey,
  buildPartAudioText,
  contentAssetGenerationClaimSchema,
  contentAssetMetaSchema,
  contentAssetTrackSchema,
  normalizePartAudioWhitespace,
} from './content-assets.ts';

describe('buildContentAssetGenerationKey', () => {
  it('is stable for the same part, role, and source content', () => {
    expect(buildContentAssetGenerationKey({ partId: 'part-1', kind: 'audio_us', contentHash: 'hash-1' })).toBe(
      'part-1:audio_us:hash-1',
    );
  });
});

describe('contentAssetGenerationClaimSchema', () => {
  it('requires the DB-backed claim and lease facts', () => {
    expect(
      contentAssetGenerationClaimSchema.parse({
        generationKey: 'part-1:audio_us:hash-1',
        generationToken: 'claim-1',
        generationClaimedAt: '2026-09-05T00:00:00.000Z',
        generationLeaseExpiresAt: '2026-09-05T00:05:00.000Z',
      }),
    ).toMatchObject({ generationKey: 'part-1:audio_us:hash-1', generationToken: 'claim-1' });
  });
});

describe('buildPartAudioText', () => {
  it('normalizes body plain text for TTS (body-only SSOT)', () => {
    expect(buildPartAudioText('  Hello   world  ')).toBe('Hello world');
    expect(buildPartAudioText('')).toBe('');
  });

  it('does not incorporate a chapter title', () => {
    const body = normalizePartAudioWhitespace('A Wolf resolved to disguise himself.');
    expect(buildPartAudioText(body)).toBe(body);
    expect(buildPartAudioText(body)).not.toContain('THE WOLF');
  });
});

const wordTiming = {
  text: 'Hello',
  audioOffsetMs: 0,
  durationMs: 120,
  textOffset: 0,
};

describe('audioTimelineSegmentSchema', () => {
  it('accepts a timing-only segment without storageKey', () => {
    const parsed = audioTimelineSegmentSchema.parse({
      index: 0,
      textHash: 'seg-hash',
      startMs: 0,
      durationMs: 500,
      wordTimings: [wordTiming],
    });
    expect(parsed.storageKey).toBeUndefined();
    expect(parsed.wordTimings).toHaveLength(1);
  });

  it('still reads a legacy segment that includes storageKey', () => {
    const parsed = audioTimelineSegmentSchema.parse({
      index: 0,
      textHash: 'seg-hash',
      startMs: 0,
      durationMs: 500,
      storageKey: 'part-audio/p1/audio_us/h/seg/0000.mp3',
      wordTimings: [wordTiming],
    });
    expect(parsed.storageKey).toBe('part-audio/p1/audio_us/h/seg/0000.mp3');
  });
});

describe('contentAssetMetaSchema', () => {
  it('accepts chapter-only metadata (formal chapter key + timing-only timeline)', () => {
    const parsed = contentAssetMetaSchema.parse({
      voice: 'en-US-JennyNeural',
      durationMs: 500,
      generatedAt: '2026-09-10T00:00:00.000Z',
      objectKeys: ['part-audio/p1/audio_us/h/chapter.mp3'],
      timeline: [
        {
          index: 0,
          textHash: 'seg-hash',
          startMs: 0,
          durationMs: 500,
          wordTimings: [wordTiming],
        },
      ],
    });
    expect(parsed.objectKeys).toEqual(['part-audio/p1/audio_us/h/chapter.mp3']);
    expect(parsed.timeline?.[0]?.storageKey).toBeUndefined();
  });

  it('does not fail whole-asset parsing when legacy metadata includes extra fields', () => {
    const parsed = contentAssetMetaSchema.parse({
      voice: 'en-US-JennyNeural',
      durationMs: 900,
      objectKeys: ['part-audio/p1/audio_us/old/seg/0000.mp3', 'part-audio/p1/audio_us/old/chapter.mp3'],
      timeline: [
        {
          index: 0,
          textHash: 'seg-hash',
          startMs: 0,
          durationMs: 900,
          storageKey: 'part-audio/p1/audio_us/old/seg/0000.mp3',
          wordTimings: [wordTiming],
        },
      ],
      legacySegmentCount: 1,
      unknownOpsFlag: true,
    });
    expect(parsed.timeline?.[0]?.storageKey).toBe('part-audio/p1/audio_us/old/seg/0000.mp3');
    expect(parsed).toMatchObject({ legacySegmentCount: 1, unknownOpsFlag: true });
  });
});

describe('contentAssetTrackSchema', () => {
  it('accepts a ready track whose timeline is timing-only', () => {
    const parsed = contentAssetTrackSchema.parse({
      role: 'us',
      status: 'ready',
      voice: 'en-US-JennyNeural',
      contentHash: 'hash-1',
      contentStale: false,
      mimeType: 'audio/mpeg',
      lastError: null,
      generatedAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
      audioAvailable: true,
      assetId: 'asset-1',
      audioUrl: '/api/assets/asset-1',
      durationMs: 500,
      timeline: [
        {
          index: 0,
          textHash: 'seg-hash',
          startMs: 0,
          durationMs: 500,
          wordTimings: [wordTiming],
        },
      ],
    });
    expect(parsed.timeline?.[0]?.storageKey).toBeUndefined();
  });
});
