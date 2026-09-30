import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisState = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
      return 'OK';
    }),
    clear() {
      values.clear();
      this.get.mockClear();
      this.set.mockClear();
    },
  };
});

vi.mock('@/infra/cache', () => ({
  getRedis: () => ({ get: redisState.get, set: redisState.set }),
}));

vi.mock('@/domains/assets/scan/config', () => ({ snapshotTtlSeconds: () => 60 }));

import type { AssetScanReport } from '@gloaming/shared/assets';

import { loadScanSnapshot, saveScanSnapshot } from '@/domains/assets/scan/snapshot';

const report: AssetScanReport = {
  scanId: 'scan_1',
  measuredAt: '2026-09-30T00:00:00.000Z',
  scanComplete: true,
  objectCount: 3,
  totalBytes: 30,
  referencedObjectCount: 1,
  referencedBytes: 10,
  orphanCount: 2,
  orphanBytes: 20,
  legacyDuplicateCount: 0,
  legacyDuplicateBytes: 0,
  missingCount: 0,
  durationMs: 5,
  categories: [{ category: 'other', objectCount: 3, bytes: 30 }],
};

describe('scan snapshots', () => {
  beforeEach(() => redisState.clear());

  it('stores only orphan identity and size for future safe cleanup', async () => {
    await saveScanSnapshot({
      report,
      orphanCandidates: [{ key: 'orphan/a.bin', size: 20 }],
    });

    const stored = redisState.values.get('asset-management:scan:v2:scan_1');
    expect(stored).toBeDefined();
    expect(JSON.parse(stored!)).toEqual({
      report,
      orphanCandidates: [{ key: 'orphan/a.bin', size: 20 }],
    });
  });

  it('does not read snapshots from the previous namespace', async () => {
    redisState.values.set(
      'asset-management:scan:scan_1',
      JSON.stringify({
        report: { ...report, largestObjects: [{ key: 'private/file.epub' }] },
        objects: [
          { key: 'private/file.epub', status: 'referenced', size: 10 },
          { key: 'orphan/a.bin', status: 'orphan', size: 20 },
          { key: 'part-audio/old/seg/0.mp3', status: 'legacy_duplicate_audio', size: 5 },
        ],
        orphanKeys: ['orphan/a.bin'],
        legacyDuplicateKeys: ['part-audio/old/seg/0.mp3'],
      }),
    );

    await expect(loadScanSnapshot('scan_1')).rejects.toThrow();
    expect(redisState.get).toHaveBeenCalledWith('asset-management:scan:v2:scan_1');
    expect(redisState.get).not.toHaveBeenCalledWith('asset-management:scan:scan_1');
  });

  it('rejects old-format payloads written into the current namespace', async () => {
    redisState.values.set(
      'asset-management:scan:v2:scan_1',
      JSON.stringify({
        report,
        objects: [{ key: 'orphan/a.bin', status: 'orphan', size: 20 }],
        orphanKeys: ['orphan/a.bin'],
      }),
    );

    await expect(loadScanSnapshot('scan_1')).rejects.toThrow();
  });
});
