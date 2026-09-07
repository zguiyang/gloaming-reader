import { describe, expect, it } from 'vitest';

import {
  buildContentAssetGenerationKey,
  buildPartAudioText,
  contentAssetGenerationClaimSchema,
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
