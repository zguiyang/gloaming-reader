import { describe, expect, it } from 'vitest';

import {
  collectFormalKeysFromContentAssetRow,
  collectKeysFromOriginMeta,
  collectLegacySegmentKeysFromContentAssetRow,
  referencedKeyIndexFromKeys,
} from '@/domains/assets/management/referenced-keys';
import { reconcileObjects } from '@/domains/assets/scan/reconcile';

describe('collectFormalKeysFromContentAssetRow', () => {
  it('returns only chapter for audio assets with legacy segment metadata', () => {
    expect(
      collectFormalKeysFromContentAssetRow({
        storageKey: 'part-audio/p1/audio_us/h/chapter.mp3',
        kind: 'audio_us',
        meta: {
          objectKeys: ['part-audio/p1/audio_us/h/seg/0000.mp3', 'part-audio/p1/audio_us/h/chapter.mp3'],
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

describe('collectLegacySegmentKeysFromContentAssetRow', () => {
  it('collects legacy segment keys from objectKeys and timeline', () => {
    expect(
      collectLegacySegmentKeysFromContentAssetRow({
        meta: {
          objectKeys: ['part-audio/p1/audio_us/h/seg/0000.mp3', 'part-audio/p1/audio_us/h/chapter.mp3'],
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

describe('formal and legacy key helpers combined', () => {
  it('collects storageKey, objectKeys, and timeline storageKeys without duplicates', () => {
    const asset = {
      storageKey: 'part-audio/p1/audio_us/h/chapter.mp3',
      kind: 'audio_us',
      meta: {
        objectKeys: ['part-audio/p1/audio_us/h/seg/0000.mp3', 'part-audio/p1/audio_us/h/chapter.mp3'],
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
    };
    const keys = [
      ...collectFormalKeysFromContentAssetRow(asset),
      ...collectLegacySegmentKeysFromContentAssetRow(asset),
    ].filter((key, index, all) => all.indexOf(key) === index);
    expect(keys.sort()).toEqual(['part-audio/p1/audio_us/h/chapter.mp3', 'part-audio/p1/audio_us/h/seg/0000.mp3']);
  });

  it('keeps a timeline-only segment key that is absent from objectKeys', () => {
    const asset = {
      storageKey: 'part-audio/p1/audio_us/old/chapter.mp3',
      kind: 'audio_us',
      meta: {
        objectKeys: ['part-audio/p1/audio_us/old/chapter.mp3'],
        timeline: [
          {
            index: 0,
            textHash: 'legacy',
            startMs: 0,
            durationMs: 800,
            storageKey: 'part-audio/p1/audio_us/old/seg/0000.mp3',
            wordTimings: [],
          },
        ],
      },
    };
    const keys = [
      ...collectFormalKeysFromContentAssetRow(asset),
      ...collectLegacySegmentKeysFromContentAssetRow(asset),
    ].filter((key, index, all) => all.indexOf(key) === index);
    expect(keys.sort()).toEqual(['part-audio/p1/audio_us/old/chapter.mp3', 'part-audio/p1/audio_us/old/seg/0000.mp3']);
  });
});

describe('collectKeysFromOriginMeta', () => {
  it('collects workflowParseArtifacts keys', () => {
    expect(
      collectKeysFromOriginMeta({
        workflowParseArtifacts: [{ attemptToken: 'a1', keys: ['book-images/w1/a/h.png', 'covers/w1/a.jpg'] }],
      }),
    ).toEqual(['book-images/w1/a/h.png', 'covers/w1/a.jpg']);
  });

  it('returns empty for missing or invalid manifests', () => {
    expect(collectKeysFromOriginMeta({})).toEqual([]);
    expect(collectKeysFromOriginMeta({ workflowParseArtifacts: [{ attemptToken: 1 }] })).toEqual([]);
  });
});

describe('reconcileObjects', () => {
  it('classifies referenced, orphan, and missing objects', () => {
    const chapter = 'part-audio/p1/audio_us/h/chapter.mp3';
    const seg = 'part-audio/p1/audio_us/h/seg/0000.mp3';
    const { report, objects, orphanKeys, legacyDuplicateKeys } = reconcileObjects({
      scanId: 'scan_test',
      measuredAt: new Date('2026-09-09T00:00:00.000Z'),
      listed: [
        { key: chapter, size: 100, lastModified: null, etag: null },
        { key: seg, size: 40, lastModified: null, etag: null },
        { key: 'orphan/old.mp3', size: 60, lastModified: null, etag: null },
      ],
      referenced: referencedKeyIndexFromKeys([chapter, seg, 'covers/missing.jpg'], {
        kinds: { [chapter]: 'audio_us', [seg]: 'audio_us', 'covers/missing.jpg': 'cover' },
      }),
    });

    expect(report.objectCount).toBe(3);
    expect(report.totalBytes).toBe(200);
    expect(report.referencedObjectCount).toBe(1);
    expect(report.referencedBytes).toBe(100);
    expect(report.orphanCount).toBe(1);
    expect(report.orphanBytes).toBe(60);
    expect(report.legacyDuplicateCount).toBe(1);
    expect(report.legacyDuplicateBytes).toBe(40);
    expect(report.missingCount).toBe(1);
    expect(report.durationMs).toBe(0);
    expect(report.scanComplete).toBe(true);
    expect(orphanKeys).toEqual(['orphan/old.mp3']);
    expect(legacyDuplicateKeys).toEqual([seg]);

    expect(objects.filter((item) => item.status === 'orphan')).toHaveLength(1);
    expect(objects.find((item) => item.key === seg)?.status).toBe('legacy_duplicate_audio');
    expect(objects.filter((item) => item.status === 'missing')).toEqual([
      expect.objectContaining({ key: 'covers/missing.jpg', category: 'cover', size: 0 }),
    ]);
  });

  it('classifies unreferenced historical segments as legacy_duplicate_audio, not orphan', () => {
    const chapter = 'part-audio/p1/audio_us/new/chapter.mp3';
    const staleSeg = 'part-audio/p1/audio_us/old/seg/0000.mp3';
    const { report, orphanKeys, legacyDuplicateKeys, objects } = reconcileObjects({
      listed: [
        { key: chapter, size: 100, lastModified: null, etag: null },
        { key: staleSeg, size: 40, lastModified: null, etag: null },
        { key: 'orphan/noise.bin', size: 5, lastModified: null, etag: null },
      ],
      referenced: referencedKeyIndexFromKeys([chapter], { kinds: { [chapter]: 'audio_us' } }),
    });

    expect(report.orphanCount).toBe(1);
    expect(report.legacyDuplicateCount).toBe(1);
    expect(report.legacyDuplicateBytes).toBe(40);
    expect(orphanKeys).toEqual(['orphan/noise.bin']);
    expect(legacyDuplicateKeys).toEqual([staleSeg]);
    expect(objects.find((item) => item.key === staleSeg)?.status).toBe('legacy_duplicate_audio');
  });

  it('aggregates category bytes and ranks largest objects', () => {
    const { report } = reconcileObjects({
      listed: [
        { key: 'epub/a.epub', size: 50, lastModified: null, etag: null },
        { key: 'covers/a.jpg', size: 10, lastModified: null, etag: null },
        { key: 'part-audio/big.mp3', size: 90, lastModified: null, etag: null },
      ],
      referenced: referencedKeyIndexFromKeys(['epub/a.epub', 'covers/a.jpg']),
      largestLimit: 2,
    });

    expect(report.categories).toEqual(
      expect.arrayContaining([
        { category: 'audio', objectCount: 1, bytes: 90 },
        { category: 'cover', objectCount: 1, bytes: 10 },
        { category: 'origin', objectCount: 1, bytes: 50 },
      ]),
    );
    expect(report.largestObjects.map((item) => item.key)).toEqual(['part-audio/big.mp3', 'epub/a.epub']);
  });

  it('classifies legacy-metadata segments as legacy_duplicate_audio, not referenced', () => {
    const chapter = 'part-audio/p1/audio_us/h/chapter.mp3';
    const seg = 'part-audio/p1/audio_us/h/seg/0000.mp3';
    const { report, objects } = reconcileObjects({
      listed: [
        { key: chapter, size: 100, lastModified: null, etag: null },
        { key: seg, size: 40, lastModified: null, etag: null },
      ],
      referenced: referencedKeyIndexFromKeys([chapter, seg], {
        kinds: { [chapter]: 'audio_us', [seg]: 'audio_us' },
      }),
    });
    expect(report.orphanCount).toBe(0);
    expect(report.legacyDuplicateCount).toBe(1);
    expect(report.referencedObjectCount).toBe(1);
    expect(objects.find((item) => item.key === seg)?.status).toBe('legacy_duplicate_audio');
  });

  it('keeps externally referenced segments as referenced', () => {
    const seg = 'part-audio/p1/audio_us/h/seg/0000.mp3';
    const { report, objects } = reconcileObjects({
      listed: [{ key: seg, size: 40, lastModified: null, etag: null }],
      referenced: referencedKeyIndexFromKeys([seg], { external: [seg] }),
    });
    expect(report.referencedObjectCount).toBe(1);
    expect(report.legacyDuplicateCount).toBe(0);
    expect(objects[0]?.status).toBe('referenced');
  });

  it('records incomplete scans and duration without treating missing as listed objects', () => {
    const listed = Array.from({ length: 1_000 }, (_, index) => ({
      key: `orphan/${index}.bin`,
      size: index + 1,
      lastModified: null,
      etag: null,
    }));
    const { report, orphanKeys } = reconcileObjects({
      listed,
      referenced: referencedKeyIndexFromKeys([]),
      scanComplete: false,
      durationMs: 42,
      largestLimit: 3,
    });
    expect(report.scanComplete).toBe(false);
    expect(report.durationMs).toBe(42);
    expect(report.objectCount).toBe(1_000);
    expect(orphanKeys).toHaveLength(1_000);
    expect(report.largestObjects).toHaveLength(3);
    expect(report.largestObjects[0]?.key).toBe('orphan/999.bin');
  });
});
