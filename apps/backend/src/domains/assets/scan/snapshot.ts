import { z } from 'zod';

import { type AssetScanReport, assetScanReportSchema } from '@gloaming/shared/assets';

import { snapshotTtlSeconds } from '@/domains/assets/scan/config';
import { getRedis } from '@/infra/cache';
import { rootLogger } from '@/infra/logging/logger';
import { HTTP_STATUS } from '@/shared/constants';
import { AppError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

const logger = rootLogger.child({ module: 'AssetManagement' });

const SCAN_KEY_PREFIX = 'asset-management:scan:v2:';

const scanSnapshotSchema = z.strictObject({
  report: z.strictObject(assetScanReportSchema.shape),
  orphanCandidates: z.array(
    z.strictObject({
      key: z.string().min(1),
      size: z.number().int().nonnegative(),
    }),
  ),
});

export type ScanSnapshot = {
  report: AssetScanReport;
  orphanCandidates: Array<{ key: string; size: number }>;
};

export function scanRedisKey(scanId: string): string {
  return `${SCAN_KEY_PREFIX}${scanId}`;
}

export async function saveScanSnapshot(snapshot: ScanSnapshot): Promise<void> {
  await getRedis().set(scanRedisKey(snapshot.report.scanId), JSON.stringify(snapshot), 'EX', snapshotTtlSeconds());
}

export async function loadScanSnapshot(scanId: string): Promise<ScanSnapshot> {
  const raw = await getRedis().get(scanRedisKey(scanId));
  if (!raw) {
    throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.ASSET_MANAGEMENT.SCAN_SNAPSHOT_EXPIRED);
  }
  try {
    const parsed = scanSnapshotSchema.parse(JSON.parse(raw));
    if (parsed.report.scanId !== scanId) {
      throw new Error('Scan snapshot ID does not match its Redis key');
    }
    return parsed;
  } catch (error) {
    logger.warn({ err: error, scanId }, 'Failed to parse scan snapshot');
    throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.ASSET_MANAGEMENT.SCAN_SNAPSHOT_EXPIRED);
  }
}
