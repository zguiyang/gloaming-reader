import { describe, expect, it } from 'vitest';

import {
  collectFormalKeysFromContentAssetRow,
  collectKeysFromOriginMeta,
  referencedKeyIndexFromKeys,
} from '@/domains/assets/management/referenced-keys';
import { reconcileObjects } from '@/domains/assets/scan/reconcile';

describe('collectFormalKeysFromContentAssetRow', () => {
  it('returns the deduplicated storageKey plus objectKeys for any kind', () => {
    expect(
      collectFormalKeysFromContentAssetRow({
        storageKey: 'book-images/p1/a.webp',
        kind: 'image',
        meta: { objectKeys: ['book-images/p1/a.webp', 'book-images/p1/a-thumb.webp'] },
      }),
    ).toEqual(['book-images/p1/a.webp', 'book-images/p1/a-thumb.webp']);
  });

  it('ignores null and empty keys', () => {
    expect(
      collectFormalKeysFromContentAssetRow({
        storageKey: 'covers/w1/cover.jpg',
        kind: 'cover',
        meta: { objectKeys: [''] },
      }),
    ).toEqual(['covers/w1/cover.jpg']);
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
  it('classifies referenced, orphan, and missing objects into safe aggregates', () => {
    const cover = 'covers/p1/cover.jpg';
    const image = 'book-images/p1/a.webp';
    const { report, orphanCandidates } = reconcileObjects({
      scanId: 'scan_test',
      measuredAt: new Date('2026-09-09T00:00:00.000Z'),
      listed: [
        { key: cover, size: 100, lastModified: null, etag: null },
        { key: image, size: 40, lastModified: null, etag: null },
        { key: 'orphan/old.mp3', size: 60, lastModified: null, etag: null },
      ],
      referenced: referencedKeyIndexFromKeys([cover, image, 'covers/missing.jpg'], {
        kinds: { [cover]: 'cover', [image]: 'image', 'covers/missing.jpg': 'cover' },
      }),
    });

    expect(report.objectCount).toBe(3);
    expect(report.totalBytes).toBe(200);
    expect(report.referencedObjectCount).toBe(2);
    expect(report.referencedBytes).toBe(140);
    expect(report.orphanCount).toBe(1);
    expect(report.orphanBytes).toBe(60);
    expect(report.missingCount).toBe(1);
    expect(report.durationMs).toBe(0);
    expect(report.scanComplete).toBe(true);
    expect(orphanCandidates).toEqual([{ key: 'orphan/old.mp3', size: 60 }]);
    expect(JSON.stringify(report)).not.toContain('orphan/old.mp3');
  });

  it('classifies unprotected legacy audio rows as unreferenced orphans', () => {
    // Retired whole-chapter audio objects are no longer reference-protected;
    // the scan reports them as orphans so cleanup may reclaim them.
    const chapter = 'part-audio/p1/legacy/chapter.mp3';
    const staleSeg = 'part-audio/p1/legacy/seg/0000.mp3';
    const { report, orphanCandidates } = reconcileObjects({
      listed: [
        { key: chapter, size: 100, lastModified: null, etag: null },
        { key: staleSeg, size: 40, lastModified: null, etag: null },
        { key: 'orphan/noise.bin', size: 5, lastModified: null, etag: null },
      ],
      referenced: referencedKeyIndexFromKeys([]),
    });

    expect(report.orphanCount).toBe(3);
    expect(report.orphanBytes).toBe(145);
    expect(orphanCandidates.map(({ key }) => key).sort()).toEqual([chapter, staleSeg, 'orphan/noise.bin'].sort());
  });

  it('aggregates category bytes without returning per-object details', () => {
    const { report } = reconcileObjects({
      listed: [
        { key: 'epub/a.epub', size: 50, lastModified: null, etag: null },
        { key: 'covers/a.jpg', size: 10, lastModified: null, etag: null },
        { key: 'misc/unknown.bin', size: 90, lastModified: null, etag: null },
      ],
      referenced: referencedKeyIndexFromKeys(['epub/a.epub', 'covers/a.jpg']),
    });

    expect(report.categories).toEqual(
      expect.arrayContaining([
        { category: 'other', objectCount: 1, bytes: 90 },
        { category: 'cover', objectCount: 1, bytes: 10 },
        { category: 'origin', objectCount: 1, bytes: 50 },
      ]),
    );
    expect(report.categories.some(({ category }) => category === 'audio')).toBe(false);
    expect(report).not.toHaveProperty('largestObjects');
  });

  it('keeps externally referenced objects as referenced', () => {
    const seg = 'reader-audio/p1/seg-0000.mp3';
    const { report, orphanCandidates } = reconcileObjects({
      listed: [{ key: seg, size: 40, lastModified: null, etag: null }],
      referenced: referencedKeyIndexFromKeys([seg], { external: [seg] }),
    });
    expect(report.referencedObjectCount).toBe(1);
    expect(report.orphanCount).toBe(0);
    expect(orphanCandidates).toEqual([]);
  });

  it('records incomplete scans and duration without treating missing as listed objects', () => {
    const listed = Array.from({ length: 1_000 }, (_, index) => ({
      key: `orphan/${index}.bin`,
      size: index + 1,
      lastModified: null,
      etag: null,
    }));
    const { report, orphanCandidates } = reconcileObjects({
      listed,
      referenced: referencedKeyIndexFromKeys([]),
      scanComplete: false,
      durationMs: 42,
    });
    expect(report.scanComplete).toBe(false);
    expect(report.durationMs).toBe(42);
    expect(report.objectCount).toBe(1_000);
    expect(orphanCandidates).toHaveLength(1_000);
    expect(report).not.toHaveProperty('largestObjects');
    expect(orphanCandidates).toContainEqual({ key: 'orphan/999.bin', size: 1_000 });
  });
});
