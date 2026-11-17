import { UnrecoverableError } from 'bullmq';

import type { DiscoverySyncJobData } from '@/jobs/discovery-sync-contract';
import {
  PROJECT_GUTENBERG_SOURCE_KEY,
  PROJECT_GUTENBERG_SYNC_TIMEOUT_MS,
} from '@/server/domains/discovery/gutenberg/constants';
import { claimScheduledDiscoverySync } from '@/server/domains/discovery/sync/admin';
import { syncProjectGutenbergCatalog } from '@/server/domains/discovery/sync/service';
import { createLogger } from '@/server/infra/logging/logger';

export { JOB_DISCOVERY_SYNC, type DiscoverySyncJobData } from '@/jobs/discovery-sync-contract';

const logger = createLogger('DiscoverySyncJob');

function parseClaimedAt(value: string | undefined): Date | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  const claimedAt = new Date(value);
  return Number.isNaN(claimedAt.getTime()) ? null : claimedAt;
}

export async function processDiscoverySync(
  data: DiscoverySyncJobData,
  options: { timeoutMs?: number } = {},
): Promise<{ status: string }> {
  const timeoutMs = options.timeoutMs ?? PROJECT_GUTENBERG_SYNC_TIMEOUT_MS;
  logger.info(
    { sourceKey: data.sourceKey, trigger: data.trigger ?? 'manual', force: data.force === true, timeoutMs },
    'Discovery sync job start',
  );

  if (data.sourceKey !== PROJECT_GUTENBERG_SOURCE_KEY) {
    throw new UnrecoverableError(`Unsupported discovery source: ${data.sourceKey}`);
  }

  let claimedAt = parseClaimedAt(data.claimedAt);
  if (data.trigger === 'schedule') {
    const claimStarted = Date.now();
    claimedAt = await claimScheduledDiscoverySync(data.sourceKey);
    logger.info({ claimed: Boolean(claimedAt), elapsedMs: Date.now() - claimStarted }, 'Discovery sync schedule claim');
    if (!claimedAt) {
      return { status: 'skipped-not-queued' };
    }
  }

  if (!claimedAt) {
    logger.info({ sourceKey: data.sourceKey }, 'Discovery sync skipped: missing claim token');
    return { status: 'skipped-not-queued' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    logger.warn({ timeoutMs }, 'Discovery sync abort timeout fired');
    controller.abort();
  }, timeoutMs);
  const startedAt = Date.now();
  try {
    const result = await syncProjectGutenbergCatalog({
      signal: controller.signal,
      claimedAt,
      force: data.force === true,
    });
    logger.info({ status: result.status, elapsedMs: Date.now() - startedAt }, 'Discovery sync job end');
    if (result.status === 'failed') {
      throw new Error(result.errorSummary);
    }
    return { status: result.status };
  } finally {
    clearTimeout(timeout);
  }
}
