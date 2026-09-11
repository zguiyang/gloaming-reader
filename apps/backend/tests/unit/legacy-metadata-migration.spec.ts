import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ContentAssetMeta } from '@gloaming/db';

import {
  buildMetadataMigrationCandidate,
  buildMetadataMigrationSkipReason,
  computeMigratedAudioMetadata,
  metadataHash,
  runLegacyMetadataMigration,
} from '@/modules/asset-management/legacy-metadata-migration';
import {
  assertMetadataMigrationExecuteArgs,
  assertSafeMetadataMigrationDatabase,
  computeMetadataMigrationFingerprint,
  LEGACY_METADATA_MIGRATION_SCHEMA_VERSION,
  type LegacyMetadataMigrationCandidate,
  type LegacyMetadataMigrationManifest,
  validateApprovedMetadataMigrationManifest,
} from '@/modules/asset-management/legacy-metadata-migration-guards';

import { parseMetadataMigrationArgs } from '../../scripts/migrate-legacy-audio-metadata.ts';

function sampleRow(overrides: Record<string, unknown> = {}) {
  const meta: ContentAssetMeta = {
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
        wordTimings: [{ text: 'hi', audioOffsetMs: 0, durationMs: 200, textOffset: 0 }],
      },
    ],
  };
  return {
    id: 'asset_1',
    workId: 'work_1',
    partId: 'p1',
    kind: 'audio_us',
    storageKey: 'part-audio/p1/audio_us/h/chapter.mp3',
    mimeType: 'audio/mpeg',
    contentHash: 'hash_v1',
    generationKey: 'gen_key',
    generationToken: null,
    generationClaimedAt: null,
    generationLeaseExpiresAt: null,
    meta,
    status: 'ready',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function sampleCandidate(overrides: Partial<LegacyMetadataMigrationCandidate> = {}): LegacyMetadataMigrationCandidate {
  const row = sampleRow();
  const candidate = buildMetadataMigrationCandidate(row)!;
  return { ...candidate, ...overrides };
}

function sampleManifest(
  candidates: LegacyMetadataMigrationCandidate[],
  overrides: Partial<LegacyMetadataMigrationManifest> = {},
): LegacyMetadataMigrationManifest {
  return {
    schemaVersion: LEGACY_METADATA_MIGRATION_SCHEMA_VERSION,
    toolVersion: 'legacy-metadata-migration@1',
    createdAt: '2026-09-10T00:00:00.000Z',
    mode: 'dry-run',
    databaseName: 'gloaming_test',
    candidateCount: candidates.length,
    fingerprint: computeMetadataMigrationFingerprint(candidates),
    removedObjectKeyCount: candidates.reduce((sum, candidate) => sum + candidate.removedObjectKeyCount, 0),
    removedTimelineKeyCount: candidates.reduce((sum, candidate) => sum + candidate.removedTimelineKeyCount, 0),
    candidates,
    updatedAssetIds: [],
    skipped: [],
    conflicts: [],
    failed: [],
    remainingLegacyReferences: 0,
    ...overrides,
  };
}

describe('computeMigratedAudioMetadata', () => {
  it('removes only legacy segment references and preserves timing data', () => {
    const row = sampleRow();
    const next = computeMigratedAudioMetadata(row);
    expect(next.objectKeys).toEqual(['part-audio/p1/audio_us/h/chapter.mp3']);
    expect(next.timeline?.[0]).toMatchObject({
      index: 0,
      textHash: 't0',
      startMs: 0,
      durationMs: 1000,
      wordTimings: [{ text: 'hi', audioOffsetMs: 0, durationMs: 200, textOffset: 0 }],
    });
    expect(next.timeline?.[0]).not.toHaveProperty('storageKey');
  });

  it('preserves non-legacy timeline storageKey values', () => {
    const customKey = 'part-audio/p1/audio_us/h/custom-track.mp3';
    const row = sampleRow({
      meta: {
        objectKeys: ['part-audio/p1/audio_us/h/chapter.mp3', 'part-audio/p1/audio_us/h/seg/0000.mp3'],
        timeline: [
          {
            index: 0,
            textHash: 't0',
            startMs: 0,
            durationMs: 1000,
            storageKey: customKey,
            wordTimings: [],
          },
        ],
      },
    });
    expect(buildMetadataMigrationCandidate(row)).toBeNull();
    expect(buildMetadataMigrationSkipReason(row)).toEqual({
      assetId: 'asset_1',
      reason: `non_legacy_timeline_storage_key:${customKey}`,
    });
  });
});

describe('metadata migration guards', () => {
  const originalEnv = process.env.ALLOW_LEGACY_AUDIO_METADATA_MIGRATION;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ALLOW_LEGACY_AUDIO_METADATA_MIGRATION;
    } else {
      process.env.ALLOW_LEGACY_AUDIO_METADATA_MIGRATION = originalEnv;
    }
  });

  it('rejects unsafe database names and execute without manifest', () => {
    expect(() => assertSafeMetadataMigrationDatabase('gloaming_production')).toThrow(/production/);
    expect(() => assertSafeMetadataMigrationDatabase('gloaming_test')).not.toThrow();
    process.env.ALLOW_LEGACY_AUDIO_METADATA_MIGRATION = '1';
    expect(() => assertMetadataMigrationExecuteArgs({ execute: true })).toThrow(/manifest/);
    expect(() =>
      assertMetadataMigrationExecuteArgs({ execute: true, approvedManifestPath: '/tmp/metadata-dry-run.json' }),
    ).toThrow(/output/);
    expect(() =>
      assertMetadataMigrationExecuteArgs({
        execute: true,
        approvedManifestPath: '/tmp/metadata-dry-run.json',
        outputPath: '/tmp/metadata-dry-run.json',
      }),
    ).toThrow(/different path/);
    expect(() =>
      assertMetadataMigrationExecuteArgs({
        execute: true,
        approvedManifestPath: '/tmp/metadata-dry-run.json',
        outputPath: '/tmp/metadata-execute.json',
      }),
    ).not.toThrow();
  });

  it('rejects metadata execute without a distinct output path', async () => {
    process.env.ALLOW_LEGACY_AUDIO_METADATA_MIGRATION = '1';
    await expect(
      runLegacyMetadataMigration({
        execute: true,
        databaseName: 'gloaming_test',
        manifestPath: '/tmp/metadata-dry-run.json',
      }),
    ).rejects.toThrow(/output/);
    await expect(
      runLegacyMetadataMigration({
        execute: true,
        databaseName: 'gloaming_test',
        manifestPath: '/tmp/metadata-dry-run.json',
        outputPath: '/tmp/metadata-dry-run.json',
      }),
    ).rejects.toThrow(/different path/);
    const parsed = parseMetadataMigrationArgs([
      '--execute',
      '--manifest',
      './tmp/metadata-dry-run.json',
      '--output',
      './tmp/metadata-execute.json',
    ]);
    expect(parsed.manifestPath).toBe(path.resolve('./tmp/metadata-dry-run.json'));
    expect(parsed.outputPath).toBe(path.resolve('./tmp/metadata-execute.json'));
  });

  it('rejects manifest database mismatch and fingerprint tampering', () => {
    const candidate = sampleCandidate();
    const manifest = sampleManifest([candidate]);
    expect(() => validateApprovedMetadataMigrationManifest(manifest, 'gloaming_test')).not.toThrow();
    expect(() => validateApprovedMetadataMigrationManifest(manifest, 'gloaming_development')).toThrow(/databaseName/);
    expect(() =>
      validateApprovedMetadataMigrationManifest(
        sampleManifest([candidate], { fingerprint: 'deadbeef' }),
        'gloaming_test',
      ),
    ).toThrow(/fingerprint/);
  });

  it('rejects manifest chapter keys and non-legacy removed keys', () => {
    const candidate = sampleCandidate({
      removedObjectKeys: ['part-audio/p1/audio_us/h/chapter.mp3'],
    });
    expect(() => validateApprovedMetadataMigrationManifest(sampleManifest([candidate]), 'gloaming_test')).toThrow(
      /non-legacy|chapter/,
    );
  });
});

describe('buildMetadataMigrationCandidate', () => {
  it('captures concurrency snapshot fields for CAS execute', () => {
    const candidate = buildMetadataMigrationCandidate(sampleRow())!;
    expect(candidate.contentHash).toBe('hash_v1');
    expect(candidate.storageKey).toBe('part-audio/p1/audio_us/h/chapter.mp3');
    expect(candidate.status).toBe('ready');
    expect(candidate.generationKey).toBe('gen_key');
    expect(candidate.removedObjectKeyCount).toBe(2);
    expect(candidate.removedTimelineKeyCount).toBe(1);
    expect(candidate.beforeMetadataHash).not.toBe(candidate.afterMetadataHash);
  });

  it('returns null when no legacy references remain', () => {
    const row = sampleRow({
      meta: {
        objectKeys: ['part-audio/p1/audio_us/h/chapter.mp3'],
        timeline: [{ index: 0, textHash: 't0', startMs: 0, durationMs: 1000, wordTimings: [] }],
      },
    });
    expect(buildMetadataMigrationCandidate(row)).toBeNull();
  });
});

describe('metadataHash', () => {
  it('detects metadata changes used for conflict detection', () => {
    const row = sampleRow();
    const before = metadataHash(row.meta ?? {});
    row.meta = computeMigratedAudioMetadata(row);
    const after = metadataHash(row.meta ?? {});
    expect(before).not.toBe(after);
  });
});
