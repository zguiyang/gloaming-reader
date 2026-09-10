import { afterEach, describe, expect, it } from 'vitest';

import {
  type ApprovedLegacySegmentCleanupManifest,
  assertLegacyCleanupExecuteArgs,
  assertLegacyCleanupExecuteAuthorized,
  validateApprovedLegacyCleanupManifest,
} from '@/modules/asset-management/legacy-segment-cleanup-guards';

function sampleManifest(
  overrides: Partial<ApprovedLegacySegmentCleanupManifest> = {},
): ApprovedLegacySegmentCleanupManifest {
  return {
    createdAt: '2026-09-10T00:00:00.000Z',
    mode: 'dry-run',
    targetBucket: 'test-bucket',
    scanComplete: true,
    listedSegmentCount: 1,
    eligibleKeys: ['part-audio/p1/audio_us/h/seg/0000.mp3'],
    eligibleCount: 1,
    eligibleBytes: 40,
    referencedSkippedCount: 0,
    skipped: [],
    deletedKeys: [],
    failed: [],
    ...overrides,
  };
}

describe('legacy segment cleanup execute guards', () => {
  const originalEnv = process.env.ALLOW_LEGACY_AUDIO_SEGMENT_CLEANUP;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ALLOW_LEGACY_AUDIO_SEGMENT_CLEANUP;
    } else {
      process.env.ALLOW_LEGACY_AUDIO_SEGMENT_CLEANUP = originalEnv;
    }
  });

  it('rejects execute without authorization env', () => {
    delete process.env.ALLOW_LEGACY_AUDIO_SEGMENT_CLEANUP;
    expect(() => assertLegacyCleanupExecuteAuthorized(true)).toThrow(/ALLOW_LEGACY_AUDIO_SEGMENT_CLEANUP/);
  });

  it('rejects execute without manifest and expected bucket', () => {
    process.env.ALLOW_LEGACY_AUDIO_SEGMENT_CLEANUP = '1';
    expect(() => assertLegacyCleanupExecuteArgs({ execute: true })).toThrow(/manifest/);
    expect(() => assertLegacyCleanupExecuteArgs({ execute: true, approvedManifestPath: '/tmp/manifest.json' })).toThrow(
      /expected-bucket/,
    );
  });

  it('rejects manifest bucket mismatch and invalid keys', () => {
    expect(() => validateApprovedLegacyCleanupManifest(sampleManifest(), 'other-bucket', 'test-bucket')).toThrow(
      /S3_BUCKET/,
    );
    expect(() =>
      validateApprovedLegacyCleanupManifest(
        sampleManifest({ targetBucket: 'other-bucket' }),
        'test-bucket',
        'test-bucket',
      ),
    ).toThrow(/targetBucket/);
    expect(() =>
      validateApprovedLegacyCleanupManifest(sampleManifest({ scanComplete: false }), 'test-bucket', 'test-bucket'),
    ).toThrow(/scanComplete/);
    expect(() =>
      validateApprovedLegacyCleanupManifest(
        sampleManifest({ eligibleKeys: ['part-audio/p1/audio_us/h/chapter.mp3'] }),
        'test-bucket',
        'test-bucket',
      ),
    ).toThrow(/legacy segment/);
    expect(() =>
      validateApprovedLegacyCleanupManifest(sampleManifest({ eligibleKeys: ['*'] }), 'test-bucket', 'test-bucket'),
    ).toThrow(/wildcard/);
  });

  it('accepts a valid approved dry-run manifest', () => {
    expect(() => validateApprovedLegacyCleanupManifest(sampleManifest(), 'test-bucket', 'test-bucket')).not.toThrow();
  });
});
