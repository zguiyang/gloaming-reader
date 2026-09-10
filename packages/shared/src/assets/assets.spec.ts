import { describe, expect, it } from 'vitest';

import {
  ASSET_CLEANUP_FAILED_SAMPLE_LIMIT,
  ASSET_CLEANUP_JOB_STATUSES,
  ASSET_SCAN_OBJECT_LIMIT,
  assetCleanupJobAcceptedSchema,
  assetCleanupJobSchema,
  assetCleanupRequestSchema,
  assetCleanupResultSchema,
  assetCleanupRetryRequestSchema,
  assetObjectItemSchema,
  assetObjectListQuerySchema,
  assetScanReportSchema,
  classifyAssetKey,
  publicFailedSample,
} from './assets.ts';

function sampleFailures(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    key: `orphan/${index}.bin`,
    error: 'AccessDenied',
  }));
}

function sampleCleanupJob(overrides: Record<string, unknown> = {}) {
  return {
    jobId: 'asset-cleanup:scan_1',
    scanId: 'scan_1',
    status: 'running',
    requestedCount: 10,
    processedCount: 4,
    deletedCount: 3,
    skippedReferencedCount: 1,
    failedCount: 0,
    deletedBytes: 90,
    failedSample: [],
    createdAt: '2026-09-10T01:00:00.000Z',
    updatedAt: '2026-09-10T01:00:05.000Z',
    ...overrides,
  };
}

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
      durationMs: 12,
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

describe('asset cleanup job contract', () => {
  it('exposes the scan object cap and job statuses', () => {
    expect(ASSET_SCAN_OBJECT_LIMIT).toBe(20_000);
    expect(ASSET_CLEANUP_FAILED_SAMPLE_LIMIT).toBe(50);
    expect(ASSET_CLEANUP_JOB_STATUSES).toEqual(['queued', 'running', 'completed', 'partial', 'failed']);
  });

  it('accepts every status enum value and rejects unknown statuses', () => {
    for (const status of ASSET_CLEANUP_JOB_STATUSES) {
      expect(assetCleanupJobSchema.parse(sampleCleanupJob({ status })).status).toBe(status);
    }
    expect(() => assetCleanupJobSchema.parse(sampleCleanupJob({ status: 'cancelled' }))).toThrow();
  });

  it('rejects negative progress fields', () => {
    expect(() => assetCleanupJobSchema.parse(sampleCleanupJob({ processedCount: -1 }))).toThrow();
    expect(() => assetCleanupJobSchema.parse(sampleCleanupJob({ requestedCount: -1 }))).toThrow();
    expect(() => assetCleanupJobSchema.parse(sampleCleanupJob({ failedCount: -1 }))).toThrow();
    expect(() => assetCleanupJobSchema.parse(sampleCleanupJob({ deletedCount: -1 }))).toThrow();
  });

  it('accepts a 202 enqueue payload', () => {
    expect(
      assetCleanupJobAcceptedSchema.parse({
        jobId: 'asset-cleanup:scan_1',
        scanId: 'scan_1',
        status: 'queued',
      }),
    ).toEqual({
      jobId: 'asset-cleanup:scan_1',
      scanId: 'scan_1',
      status: 'queued',
    });
  });

  it('reuses confirmed:true for retry', () => {
    expect(assetCleanupRetryRequestSchema.parse({ confirmed: true })).toEqual({ confirmed: true });
    expect(() => assetCleanupRetryRequestSchema.parse({ confirmed: false })).toThrow();
  });

  it('accepts a running job with a bounded failure sample', () => {
    const job = assetCleanupJobSchema.parse(sampleCleanupJob());
    expect(job.status).toBe('running');
    expect(job.failedSample).toEqual([]);
  });

  it('accepts a partial job with verification and failure keys', () => {
    const job = assetCleanupJobSchema.parse(
      sampleCleanupJob({
        status: 'partial',
        requestedCount: 2,
        processedCount: 2,
        deletedCount: 1,
        skippedReferencedCount: 0,
        failedCount: 1,
        deletedBytes: 40,
        failedSample: [{ key: 'orphan/a.mp3', error: 'AccessDenied' }],
        verification: { ran: true, orphanCount: 1, missingCount: 0, scanComplete: true, scanId: 'scan_2' },
        updatedAt: '2026-09-10T01:01:00.000Z',
      }),
    );
    expect(job.failedSample[0]?.key).toBe('orphan/a.mp3');
    expect(job.verification?.ran).toBe(true);
    expect(job.verification?.scanComplete).toBe(true);
  });

  it('accepts verification with scanComplete false', () => {
    const job = assetCleanupJobSchema.parse(
      sampleCleanupJob({
        status: 'partial',
        verification: { ran: true, orphanCount: 0, missingCount: 0, scanComplete: false, scanId: 'scan_2' },
      }),
    );
    expect(job.verification?.scanComplete).toBe(false);
  });

  it('rejects a failure sample longer than the public cap', () => {
    expect(() =>
      assetCleanupJobSchema.parse(
        sampleCleanupJob({
          failedCount: 51,
          failedSample: sampleFailures(ASSET_CLEANUP_FAILED_SAMPLE_LIMIT + 1),
        }),
      ),
    ).toThrow();
  });

  it('accepts a large failedCount with a capped sample', () => {
    const job = assetCleanupJobSchema.parse(
      sampleCleanupJob({
        status: 'partial',
        requestedCount: 20_000,
        processedCount: 20_000,
        failedCount: 20_000,
        failedSample: sampleFailures(ASSET_CLEANUP_FAILED_SAMPLE_LIMIT),
      }),
    );
    expect(job.failedCount).toBe(20_000);
    expect(job.failedSample).toHaveLength(ASSET_CLEANUP_FAILED_SAMPLE_LIMIT);
  });

  it('slices internal failure lists to the public sample cap', () => {
    expect(publicFailedSample(sampleFailures(60))).toHaveLength(ASSET_CLEANUP_FAILED_SAMPLE_LIMIT);
    expect(publicFailedSample(sampleFailures(10))).toHaveLength(10);
  });
});
