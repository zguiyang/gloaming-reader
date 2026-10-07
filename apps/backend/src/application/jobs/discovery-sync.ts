import { UnrecoverableError } from 'bullmq';

import { PROJECT_GUTENBERG_SOURCE_KEY } from '@/domains/discovery/gutenberg/constants';
import { syncProjectGutenbergMetadata } from '@/domains/discovery/sync/service';

export const JOB_DISCOVERY_SYNC = 'discovery-sync';

export type DiscoverySyncJobData = {
  sourceKey: string;
};

/**
 * Background Project Gutenberg metadata sync. The sync service persists its own
 * source status (`syncing` / `succeeded` / `failed`); a failed run is re-thrown
 * so the queue records the same failure the source status reports. A run that
 * finds the source disabled releases its queued claim and returns
 * `skipped-disabled` without fetching upstream.
 */
export async function processDiscoverySync(data: DiscoverySyncJobData): Promise<{ status: string }> {
  if (data.sourceKey !== PROJECT_GUTENBERG_SOURCE_KEY) {
    throw new UnrecoverableError(`Unsupported discovery source: ${data.sourceKey}`);
  }

  const result = await syncProjectGutenbergMetadata();
  if (result.status === 'failed') {
    throw new Error(result.errorSummary);
  }
  return { status: result.status };
}
