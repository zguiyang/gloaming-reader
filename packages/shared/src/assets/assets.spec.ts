import { describe, expect, it } from 'vitest';

import {
  assetCleanupRequestSchema,
  assetCleanupResultSchema,
  assetObjectItemSchema,
  assetObjectListQuerySchema,
  assetScanReportSchema,
  classifyAssetKey,
} from './assets.ts';

describe('classifyAssetKey', () => {
  it('prefers kind over key prefix', () => {
    expect(classifyAssetKey('weird/path.bin', 'audio_us')).toBe('audio');
    expect(classifyAssetKey('weird/path.bin', 'cover')).toBe('cover');
    expect(classifyAssetKey('weird/path.bin', 'image')).toBe('image');
    expect(classifyAssetKey('weird/path.bin', 'origin_file')).toBe('origin');
  });

  it('falls back to key prefixes', () => {
    expect(classifyAssetKey('part-audio/p1/audio_us/h/chapter.mp3')).toBe('audio');
    expect(classifyAssetKey('covers/w1/a.jpg')).toBe('cover');
    expect(classifyAssetKey('book-images/w1/a/h.png')).toBe('image');
    expect(classifyAssetKey('epub/abc.epub')).toBe('origin');
    expect(classifyAssetKey('misc/unknown.bin')).toBe('other');
  });
});

describe('assetScanReportSchema', () => {
  it('accepts a complete scan report', () => {
    const report = assetScanReportSchema.parse({
      scanId: 'scan_1',
      measuredAt: '2026-09-09T06:32:00.000Z',
      scanComplete: true,
      objectCount: 2,
      totalBytes: 100,
      referencedObjectCount: 1,
      referencedBytes: 40,
      orphanCount: 1,
      orphanBytes: 60,
      missingCount: 0,
      categories: [{ category: 'audio', objectCount: 2, bytes: 100 }],
      largestObjects: [
        {
          key: 'part-audio/x/chapter.mp3',
          category: 'audio',
          status: 'orphan',
          size: 60,
          lastModified: '2026-08-21T10:30:00.000Z',
          etag: '"abc"',
        },
      ],
    });
    expect(report.orphanCount).toBe(1);
  });
});

describe('assetObjectListQuerySchema', () => {
  it('defaults status, category, sort, and page size', () => {
    expect(assetObjectListQuerySchema.parse({})).toMatchObject({
      page: 1,
      pageSize: 20,
      sortBy: 'size',
      sortOrder: 'desc',
      status: 'all',
      category: 'all',
    });
  });

  it('accepts filter and sort overrides', () => {
    expect(
      assetObjectListQuerySchema.parse({
        status: 'orphan',
        category: 'audio',
        sortBy: 'key',
        sortOrder: 'asc',
        page: '2',
        pageSize: '10',
      }),
    ).toMatchObject({
      status: 'orphan',
      category: 'audio',
      sortBy: 'key',
      sortOrder: 'asc',
      page: 2,
      pageSize: 10,
    });
  });
});

describe('assetObjectItemSchema', () => {
  it('requires status and category enums', () => {
    expect(() =>
      assetObjectItemSchema.parse({
        key: 'k',
        category: 'nope',
        status: 'orphan',
        size: 1,
        lastModified: null,
        etag: null,
      }),
    ).toThrow();
  });
});

describe('assetCleanupRequestSchema', () => {
  it('requires confirmed literal true', () => {
    expect(assetCleanupRequestSchema.parse({ confirmed: true })).toEqual({ confirmed: true });
    expect(() => assetCleanupRequestSchema.parse({ confirmed: false })).toThrow();
  });
});

describe('assetCleanupResultSchema', () => {
  it('accepts cleanup stats with failure list', () => {
    const result = assetCleanupResultSchema.parse({
      scanId: 'scan_1',
      requestedCount: 2,
      deletedCount: 1,
      skippedReferencedCount: 1,
      failedCount: 0,
      deletedBytes: 100,
      failed: [],
    });
    expect(result.deletedCount).toBe(1);
  });
});
