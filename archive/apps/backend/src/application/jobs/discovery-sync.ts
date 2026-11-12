import { UnrecoverableError } from 'bullmq';

import {
  PROJECT_GUTENBERG_SOURCE_KEY,
  PROJECT_GUTENBERG_SYNC_TIMEOUT_MS,
} from '@/domains/discovery/gutenberg/constants';
import { syncProjectGutenbergMetadata } from '@/domains/discovery/sync/service';

export const JOB_DISCOVERY_SYNC = 'discovery-sync';

export type DiscoverySyncJobData = {
  sourceKey: string;
  /** ISO timestamp of the queued claim generation that enqueued this job. */
  claimedAt: string;
  /**
   * Explicit admin opt-in to a full refresh: the run then requests the snapshot
   * unconditionally (no `If-Modified-Since`) so a fixed parser can reprocess
   * historical records. Only the literal `true` enables it; any other value
   * keeps the default conditional behavior.
   */
  force?: boolean;
};

/** Parses the claim generation token; null when missing or malformed. */
function parseClaimedAt(value: string | undefined): Date | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  const claimedAt = new Date(value);
  return Number.isNaN(claimedAt.getTime()) ? null : claimedAt;
}

/**
 * Background Project Gutenberg metadata sync. The sync service persists its own
 * source status (`syncing` / `succeeded` / `failed`); a failed run is re-thrown
 * so the queue records the same failure the source status reports. A run that
 * finds the source disabled releases its queued claim and returns
 * `skipped-disabled` without fetching upstream. A job whose claim token is
 * missing, malformed, or belongs to an older generation returns
 * `skipped-not-queued` without calling the service, so a duplicate or stale
 * delivery can never act on a newer claim.
 *
 * One run is bounded by {@link PROJECT_GUTENBERG_SYNC_TIMEOUT_MS}: past the
 * limit the snapshot stream is aborted and the run is reported as a timed-out
 * failure, so a hung upstream fetch cannot leave the source in `syncing`.
 */
export async function processDiscoverySync(
  data: DiscoverySyncJobData,
  options: { timeoutMs?: number } = {},
): Promise<{ status: string }> {
  if (data.sourceKey !== PROJECT_GUTENBERG_SOURCE_KEY) {
    throw new UnrecoverableError(`Unsupported discovery source: ${data.sourceKey}`);
  }

  const claimedAt = parseClaimedAt(data.claimedAt);
  if (!claimedAt) {
    // Old in-flight jobs may lack the claim field; without it they cannot prove
    // ownership of the current queued claim, so they must not start a run.
    return { status: 'skipped-not-queued' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? PROJECT_GUTENBERG_SYNC_TIMEOUT_MS);
  try {
    const result = await syncProjectGutenbergMetadata({
      signal: controller.signal,
      claimedAt,
      force: data.force === true,
    });
    if (result.status === 'failed') {
      throw new Error(result.errorSummary);
    }
    return { status: result.status };
  } finally {
    clearTimeout(timeout);
  }
}
