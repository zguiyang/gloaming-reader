import { describe, expect, it } from 'vitest';

import {
  ASSET_CLEANUP_JOB_STATUSES,
  ASSET_SCAN_OBJECT_LIMIT,
  assetCleanupJobAcceptedSchema,
  assetCleanupJobSchema,
  assetCleanupRequestSchema,
  assetCleanupRetryRequestSchema,
  assetScanReportSchema,
  classifyAssetKey,
} from './assets.ts';

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
    createdAt: '2026-09-10T01:00:00.000Z',
    updatedAt: '2026-09-10T01:00:05.000Z',
    ...overrides,
  };
}

describe('classifyAssetKey', () => {
  it('prefers kind over key prefix', () => {
    expect(classifyAssetKey('weird/path.bin', 'cover')).toBe('cover');
    expect(classifyAssetKey('weird/path.bin', 'image')).toBe('image');
    expect(classifyAssetKey('weird/path.bin', 'origin_file')).toBe('origin');
    expect(classifyAssetKey('weird/path.bin', 'unknown_kind')).toBe('other');
  });

  it('falls back to key prefixes', () => {
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
      categories: [{ category: 'other', objectCount: 2, bytes: 100 }],
    });
    expect(report.orphanCount).toBe(1);
    expect(report).not.toHaveProperty('largestObjects');
  });
});

describe('assetCleanupRequestSchema', () => {
  it('requires confirmed literal true', () => {
    expect(assetCleanupRequestSchema.parse({ confirmed: true })).toEqual({ confirmed: true });
    expect(() => assetCleanupRequestSchema.parse({ confirmed: false })).toThrow();
  });
});

describe('asset cleanup job contract', () => {
  it('exposes the scan object cap and job statuses', () => {
    expect(ASSET_SCAN_OBJECT_LIMIT).toBe(20_000);
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

  it('projects only aggregate job status even if a legacy payload has object details', () => {
    const job = assetCleanupJobSchema.parse({
      ...sampleCleanupJob(),
      failedSample: [{ key: 'private/user/file.epub', error: 'AccessDenied' }],
      error: 'provider failed for private/user/file.epub',
    });
    expect(job.status).toBe('running');
    expect(job).not.toHaveProperty('failedSample');
    expect(job).not.toHaveProperty('error');
  });

  it('accepts a partial job with aggregate verification', () => {
    const job = assetCleanupJobSchema.parse(
      sampleCleanupJob({
        status: 'partial',
        requestedCount: 2,
        processedCount: 2,
        deletedCount: 1,
        skippedReferencedCount: 0,
        failedCount: 1,
        deletedBytes: 40,
        verification: { ran: true, orphanCount: 1, missingCount: 0, scanComplete: true, scanId: 'scan_2' },
        updatedAt: '2026-09-10T01:01:00.000Z',
      }),
    );
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

  it('accepts a large aggregate failedCount', () => {
    const job = assetCleanupJobSchema.parse(
      sampleCleanupJob({
        status: 'partial',
        requestedCount: 20_000,
        processedCount: 20_000,
        failedCount: 20_000,
      }),
    );
    expect(job.failedCount).toBe(20_000);
  });
});
