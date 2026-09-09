import { describe, expect, it } from 'vitest';

import {
  collectKeysFromContentAssetRow,
  collectKeysFromOriginMeta,
  reconcileObjects,
  type ReferencedKeyIndex,
} from '@/modules/asset-management/service';

describe('collectKeysFromContentAssetRow', () => {
  it('collects storageKey, objectKeys, and timeline storageKeys without duplicates', () => {
    const keys = collectKeysFromContentAssetRow({
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
    });
    expect(keys.sort()).toEqual(['part-audio/p1/audio_us/h/chapter.mp3', 'part-audio/p1/audio_us/h/seg/0000.mp3']);
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
  function refs(keys: string[], kinds: Record<string, string> = {}): ReferencedKeyIndex {
    return {
      keys: new Set(keys),
      kindByKey: new Map(Object.entries(kinds)),
    };
  }

  it('classifies referenced, orphan, and missing objects', () => {
    const { report, objects, orphanKeys } = reconcileObjects({
      scanId: 'scan_test',
      measuredAt: new Date('2026-09-09T00:00:00.000Z'),
      listed: [
        { key: 'part-audio/p1/audio_us/h/chapter.mp3', size: 100, lastModified: null, etag: null },
        { key: 'part-audio/p1/audio_us/h/seg/0000.mp3', size: 40, lastModified: null, etag: null },
        { key: 'orphan/old.mp3', size: 60, lastModified: null, etag: null },
      ],
      referenced: refs(
        ['part-audio/p1/audio_us/h/chapter.mp3', 'part-audio/p1/audio_us/h/seg/0000.mp3', 'covers/missing.jpg'],
        {
          'part-audio/p1/audio_us/h/chapter.mp3': 'audio_us',
          'part-audio/p1/audio_us/h/seg/0000.mp3': 'audio_us',
          'covers/missing.jpg': 'cover',
        },
      ),
    });

    expect(report.objectCount).toBe(3);
    expect(report.totalBytes).toBe(200);
    expect(report.referencedObjectCount).toBe(2);
    expect(report.referencedBytes).toBe(140);
    expect(report.orphanCount).toBe(1);
    expect(report.orphanBytes).toBe(60);
    expect(report.missingCount).toBe(1);
    expect(orphanKeys).toEqual(['orphan/old.mp3']);

    expect(objects.filter((item) => item.status === 'orphan')).toHaveLength(1);
    expect(objects.filter((item) => item.status === 'missing')).toEqual([
      expect.objectContaining({ key: 'covers/missing.jpg', category: 'cover', size: 0 }),
    ]);
  });

  it('aggregates category bytes and ranks largest objects', () => {
    const { report } = reconcileObjects({
      listed: [
        { key: 'epub/a.epub', size: 50, lastModified: null, etag: null },
        { key: 'covers/a.jpg', size: 10, lastModified: null, etag: null },
        { key: 'part-audio/big.mp3', size: 90, lastModified: null, etag: null },
      ],
      referenced: refs(['epub/a.epub', 'covers/a.jpg']),
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

  it('does not treat audio segment keys as orphans when referenced via meta', () => {
    const chapter = 'part-audio/p1/audio_us/h/chapter.mp3';
    const seg = 'part-audio/p1/audio_us/h/seg/0000.mp3';
    const { report } = reconcileObjects({
      listed: [
        { key: chapter, size: 100, lastModified: null, etag: null },
        { key: seg, size: 40, lastModified: null, etag: null },
      ],
      referenced: refs([chapter, seg], { [chapter]: 'audio_us', [seg]: 'audio_us' }),
    });
    expect(report.orphanCount).toBe(0);
    expect(report.referencedObjectCount).toBe(2);
  });
});
