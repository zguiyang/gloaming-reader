import { describe, expect, it, vi } from 'vitest';

import { verifyLegacySegmentCleanupAfterExecute } from '@/modules/asset-management/legacy-segment-cleanup';
import {
  type ApprovedLegacySegmentCleanupManifest,
  computeLegacyCleanupEligibleKeysFingerprint,
  validateApprovedLegacyCleanupManifest,
} from '@/modules/asset-management/legacy-segment-cleanup-guards';
import * as assetService from '@/modules/asset-management/service';
import * as ossModule from '@/modules/oss';

function sampleManifest(
  overrides: Partial<ApprovedLegacySegmentCleanupManifest> = {},
): ApprovedLegacySegmentCleanupManifest {
  const eligibleKeys = overrides.eligibleKeys ?? ['part-audio/p1/audio_us/h/seg/0000.mp3'];
  return {
    createdAt: '2026-09-10T00:00:00.000Z',
    mode: 'dry-run',
    targetBucket: 'gloaming-test',
    scanComplete: true,
    listedSegmentCount: 1,
    eligibleKeys,
    eligibleKeysFingerprint: computeLegacyCleanupEligibleKeysFingerprint(eligibleKeys),
    eligibleCount: eligibleKeys.length,
    eligibleBytes: 40,
    referencedSkippedCount: 0,
    skipped: [],
    deletedKeys: [],
    failed: [],
    ...overrides,
  };
}

describe('legacy cleanup manifest integrity', () => {
  it('rejects count mismatch, duplicates, and eligible/skipped overlap', () => {
    expect(() =>
      validateApprovedLegacyCleanupManifest(sampleManifest(), 'gloaming-test', 'gloaming-test'),
    ).not.toThrow();
    expect(() =>
      validateApprovedLegacyCleanupManifest(sampleManifest({ eligibleCount: 2 }), 'gloaming-test', 'gloaming-test'),
    ).toThrow(/eligibleCount/);
    expect(() =>
      validateApprovedLegacyCleanupManifest(
        sampleManifest({
          eligibleKeys: ['part-audio/p1/audio_us/h/seg/0000.mp3', 'part-audio/p1/audio_us/h/seg/0000.mp3'],
        }),
        'gloaming-test',
        'gloaming-test',
      ),
    ).toThrow(/duplicates/);
    expect(() =>
      validateApprovedLegacyCleanupManifest(
        sampleManifest({
          eligibleKeys: ['part-audio/p1/audio_us/h/seg/0000.mp3'],
          skipped: [{ key: 'part-audio/p1/audio_us/h/seg/0000.mp3', reason: 'still_referenced' }],
        }),
        'gloaming-test',
        'gloaming-test',
      ),
    ).toThrow(/overlap/);
    expect(() =>
      validateApprovedLegacyCleanupManifest(
        sampleManifest({ eligibleKeysFingerprint: 'deadbeef' }),
        'gloaming-test',
        'gloaming-test',
      ),
    ).toThrow(/eligibleKeysFingerprint/);
  });
});

describe('verifyLegacySegmentCleanupAfterExecute', () => {
  it('fails when deleted keys still exist or chapter/formal references are missing', async () => {
    const seg = 'part-audio/p1/audio_us/h/seg/0000.mp3';
    const chapter = 'part-audio/p1/audio_us/h/chapter.mp3';

    vi.spyOn(ossModule, 'objectExists').mockImplementation(async (key: string) => {
      if (key === seg) return true;
      if (key === chapter) return true;
      return false;
    });
    vi.spyOn(assetService, 'collectReferencedStorageKeys').mockResolvedValue({
      formalKeys: new Set([chapter]),
      externalReferencedKeys: new Set(),
      legacyAudioSegmentKeys: new Set(),
      allReferencedKeys: new Set([chapter]),
      kindByKey: new Map([[chapter, 'audio_us']]),
    });

    const failed = await verifyLegacySegmentCleanupAfterExecute({ deletedKeys: [seg] });
    expect(failed.passed).toBe(false);
    expect(failed.deletedKeysStillPresent).toEqual([seg]);

    vi.mocked(ossModule.objectExists).mockImplementation(async (key: string) => key === chapter);
    const missingChapter = await verifyLegacySegmentCleanupAfterExecute({
      deletedKeys: ['part-audio/p2/audio_us/h/seg/0000.mp3'],
    });
    expect(missingChapter.passed).toBe(false);
    expect(missingChapter.missingChapterKeys.length).toBeGreaterThan(0);

    vi.spyOn(assetService, 'collectReferencedStorageKeys').mockResolvedValue({
      formalKeys: new Set(),
      externalReferencedKeys: new Set(),
      legacyAudioSegmentKeys: new Set(),
      allReferencedKeys: new Set(),
      kindByKey: new Map(),
    });
    const missingFormal = await verifyLegacySegmentCleanupAfterExecute({ deletedKeys: [seg] });
    expect(missingFormal.passed).toBe(false);
    expect(missingFormal.missingFormalAssetKeys).toContain(chapter);

    vi.restoreAllMocks();
  });

  it('passes when deleted keys are gone and chapter formal references remain', async () => {
    const seg = 'part-audio/p1/audio_us/h/seg/0000.mp3';
    const chapter = 'part-audio/p1/audio_us/h/chapter.mp3';
    vi.spyOn(ossModule, 'objectExists').mockImplementation(async (key: string) => key === chapter);
    vi.spyOn(assetService, 'collectReferencedStorageKeys').mockResolvedValue({
      formalKeys: new Set([chapter]),
      externalReferencedKeys: new Set(),
      legacyAudioSegmentKeys: new Set(),
      allReferencedKeys: new Set([chapter]),
      kindByKey: new Map([[chapter, 'audio_us']]),
    });

    const result = await verifyLegacySegmentCleanupAfterExecute({ deletedKeys: [seg] });
    expect(result.passed).toBe(true);
    vi.restoreAllMocks();
  });
});
