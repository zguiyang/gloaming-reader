import type { DiscoverySourceStatus, DiscoverySyncAccepted } from '@gloaming/shared/discovery';

import { JOB_DISCOVERY_SYNC } from '@/application/jobs/discovery-sync';
import {
  PROJECT_GUTENBERG_SOURCE_KEY,
  PROJECT_GUTENBERG_SOURCE_TYPE,
  PROJECT_GUTENBERG_STALE_QUEUED_MS,
  PROJECT_GUTENBERG_STALE_SYNCING_MS,
} from '@/domains/discovery/gutenberg/constants';
import type { DiscoverySourceRow } from '@/domains/discovery/sync/repository';
import {
  claimSourceQueued,
  countSourceRecords,
  ensureDiscoverySource,
  failQueuedClaim,
  recoverStaleSourceRun,
  setSourceEnabled,
} from '@/domains/discovery/sync/repository';
import { rootLogger } from '@/infra/logging/logger';
import { enqueueDiscoverySync, getDiscoverySyncQueue } from '@/infra/queue';

const logger = rootLogger.child({ module: 'DiscoverySourceAdmin' });

/** Sanitized summaries recorded when a lost run is recovered as timed out. */
const STALE_QUEUED_ERROR_SUMMARY = 'the Project Gutenberg metadata sync was queued but never started (timed out)';
const STALE_SYNCING_ERROR_SUMMARY = 'the Project Gutenberg metadata sync exceeded its time limit';

/**
 * Deterministic queue job id for one queued Gutenberg sync claim: derived only
 * from the source key and the claim token (`syncStartedAt`), so a status read
 * can fetch exactly the job that owns the claim. Hyphen-separated epoch
 * milliseconds and deliberately free of `:`, which BullMQ uses as a Redis key
 * separator.
 */
export function discoverySyncJobId(sourceKey: string, claimedAt: Date): string {
  return `${JOB_DISCOVERY_SYNC}-${sourceKey}-${claimedAt.getTime()}`;
}

/**
 * True when the queue job owning the source's `queued` claim still exists and
 * has not reached a terminal state. The lookup is a direct `getJob()` by the
 * claim's deterministic id — never a bounded `getJobs()` scan, so a live job
 * cannot be pushed out of a page window by newer jobs. A job held by a paused
 * queue reports state `waiting`, so it counts as live; any state other than
 * `completed`/`failed` is conservatively treated as live. On any queue/Redis
 * error this fails safe by reporting `true`: when liveness cannot be verified,
 * a queued claim is never declared failed.
 */
async function hasLiveQueuedJob(source: DiscoverySourceRow): Promise<boolean> {
  try {
    if (!source.syncStartedAt) {
      // No persisted claim token: no job can own this claim.
      return false;
    }
    const job = await getDiscoverySyncQueue().getJob(discoverySyncJobId(source.sourceKey, source.syncStartedAt));
    if (!job) {
      return false;
    }
    const state = await job.getState();
    return state !== 'completed' && state !== 'failed';
  } catch (error) {
    logger.warn(
      { err: error, sourceKey: source.sourceKey },
      'Could not verify Gutenberg sync queue liveness; skipping stale queued recovery',
    );
    return true;
  }
}

/**
 * Recovers a lost `queued`/`syncing` run (e.g. the worker died before finishing)
 * so the source cannot stay stuck. Recovery is age-bounded and atomic, so a live
 * run is never misjudged; it only converts a stale claim into a visible timeout
 * failure. It never starts a new scan — a new run still requires an explicit
 * admin trigger.
 *
 * A stale `queued` claim is additionally verified against queue liveness first:
 * a job still waiting in the queue owns the claim, so it is never failed. A
 * stale `syncing` run stays age-based only, because a live executor self-aborts
 * by its own 30-minute watchdog (PROJECT_GUTENBERG_SYNC_TIMEOUT_MS) and a Redis
 * `active` lock may outlive a dead worker — queue state is not proof of liveness
 * there, and the generation-fenced writes in the repository are the protection.
 */
async function recoverStaleRun(source: DiscoverySourceRow): Promise<DiscoverySourceRow> {
  const queuedPastStaleAge =
    source.syncStatus === 'queued' && Date.now() - source.updatedAt.getTime() >= PROJECT_GUTENBERG_STALE_QUEUED_MS;
  if (queuedPastStaleAge && (await hasLiveQueuedJob(source))) {
    // A live job still owns this queued claim: leave it untouched.
    return source;
  }
  const recovered = await recoverStaleSourceRun({
    sourceId: source.id,
    now: new Date(),
    queuedStaleAfterMs: PROJECT_GUTENBERG_STALE_QUEUED_MS,
    syncingStaleAfterMs: PROJECT_GUTENBERG_STALE_SYNCING_MS,
    queuedErrorSummary: STALE_QUEUED_ERROR_SUMMARY,
    syncingErrorSummary: STALE_SYNCING_ERROR_SUMMARY,
  });
  if (recovered) {
    logger.warn(
      { sourceKey: source.sourceKey, syncStatus: recovered.syncStatus },
      'Recovered a stale Gutenberg metadata sync run as timed out',
    );
    return recovered;
  }
  return source;
}

function toSourceStatus(source: DiscoverySourceRow, recordCount: number): DiscoverySourceStatus {
  return {
    sourceKey: source.sourceKey,
    sourceType: source.sourceType,
    enabled: source.enabled,
    syncStatus: source.syncStatus,
    syncStartedAt: source.syncStartedAt,
    syncFinishedAt: source.syncFinishedAt,
    lastSuccessAt: source.lastSuccessAt,
    recordCount,
    lastErrorSummary: source.lastErrorSummary,
  };
}

async function loadProjectGutenbergSource(): Promise<DiscoverySourceRow> {
  return ensureDiscoverySource(PROJECT_GUTENBERG_SOURCE_KEY, PROJECT_GUTENBERG_SOURCE_TYPE);
}

/** Read-only admin status for the Project Gutenberg source. */
export async function getProjectGutenbergSourceStatus(): Promise<DiscoverySourceStatus> {
  const source = await recoverStaleRun(await loadProjectGutenbergSource());
  const recordCount = await countSourceRecords(source.id);
  return toSourceStatus(source, recordCount);
}

/** Persist the admin enable/disable flag and return the resulting status. */
export async function setProjectGutenbergSourceEnabled(enabled: boolean): Promise<DiscoverySourceStatus> {
  const source = await loadProjectGutenbergSource();
  const updated = await setSourceEnabled(source.id, enabled);
  const recordCount = await countSourceRecords(updated.id);
  return toSourceStatus(updated, recordCount);
}

/**
 * Requests one manual Project Gutenberg metadata sync. Returns immediately after
 * enqueuing the background snapshot sync. A disabled source is never claimed, and
 * a pending run keeps its claim, so repeated triggers return `disabled` or
 * `already_running` instead of stacking jobs. A stale queued claim with no
 * live queue job — or a stale syncing run — is first recovered as a timed-out
 * failure; that recovery alone does not start a new run — this trigger then
 * claims (issuing a fresh claim generation token) and enqueues one.
 */
export async function requestProjectGutenbergSync(): Promise<DiscoverySyncAccepted> {
  const source = await recoverStaleRun(await loadProjectGutenbergSource());
  if (!source.enabled) {
    return { result: 'disabled' };
  }
  const claimedAt = await claimSourceQueued(source.id);
  if (!claimedAt) {
    // Re-read: the source may have been disabled between the check and the claim.
    const current = await loadProjectGutenbergSource();
    return { result: current.enabled ? 'already_running' : 'disabled' };
  }

  try {
    await enqueueDiscoverySync(
      JOB_DISCOVERY_SYNC,
      { sourceKey: PROJECT_GUTENBERG_SOURCE_KEY, claimedAt: claimedAt.toISOString() },
      { attempts: 1, jobId: discoverySyncJobId(PROJECT_GUTENBERG_SOURCE_KEY, claimedAt) },
    );
  } catch {
    // Sanitized summary only: enqueue failures may carry connection details.
    // Owner-guarded: only the exact claim issued above can be failed here.
    await failQueuedClaim(source.id, claimedAt, 'the Project Gutenberg metadata sync could not be queued', new Date());
    logger.warn({ sourceKey: PROJECT_GUTENBERG_SOURCE_KEY }, 'Failed to enqueue Gutenberg metadata sync');
    throw new Error('Failed to enqueue the Project Gutenberg metadata sync');
  }

  logger.info({ sourceKey: PROJECT_GUTENBERG_SOURCE_KEY }, 'Gutenberg metadata sync enqueued');
  return { result: 'queued' };
}
