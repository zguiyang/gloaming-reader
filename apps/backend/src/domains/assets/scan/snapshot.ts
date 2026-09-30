import { type AssetScanReport, assetScanReportSchema } from '@gloaming/shared/assets';

import { snapshotTtlSeconds } from '@/domains/assets/scan/config';
import { getRedis } from '@/infra/cache';
import { rootLogger } from '@/infra/logging/logger';
import { HTTP_STATUS } from '@/shared/constants';
import { AppError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

const logger = rootLogger.child({ module: 'AssetManagement' });

const SCAN_KEY_PREFIX = 'asset-management:scan:';

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
    const parsed = JSON.parse(raw) as Partial<ScanSnapshot> & {
      report: AssetScanReport;
      objects?: Array<{ key: string; size: number; status: string }>;
      orphanKeys?: string[];
    };
    const orphanCandidates =
      parsed.orphanCandidates ??
      (parsed.orphanKeys
        ? parsed.orphanKeys.map((key) => ({
            key,
            size: parsed.objects?.find((item) => item.key === key)?.size ?? 0,
          }))
        : (parsed.objects ?? []).filter((item) => item.status === 'orphan').map(({ key, size }) => ({ key, size })));
    const reportData: Record<string, unknown> = { ...parsed.report };
    delete reportData.largestObjects;
    return {
      report: assetScanReportSchema.parse(reportData),
      orphanCandidates,
    };
  } catch (error) {
    logger.warn({ err: error, scanId }, 'Failed to parse scan snapshot');
    throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.ASSET_MANAGEMENT.SCAN_SNAPSHOT_EXPIRED);
  }
}
