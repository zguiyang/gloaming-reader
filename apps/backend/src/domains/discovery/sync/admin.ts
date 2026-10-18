import { eq } from 'drizzle-orm';

import { discoverySource as discoverySourceTable } from '@gloaming/db/schema';
import type {
  DiscoverySourceStatus,
  DiscoverySyncAccepted,
  DiscoverySyncConsumerState,
  DiscoverySyncRunHistory,
  DiscoverySyncRunProgress,
  DiscoverySyncRunSummary,
} from '@gloaming/shared/discovery';

import { JOB_DISCOVERY_SYNC } from '@/application/jobs/discovery-sync';
import {
  PROJECT_GUTENBERG_SOURCE_KEY,
  PROJECT_GUTENBERG_SOURCE_TYPE,
  PROJECT_GUTENBERG_STALE_QUEUED_MS,
  PROJECT_GUTENBERG_STALE_SYNCING_MS,
} from '@/domains/discovery/gutenberg/constants';
import type { DiscoverySourceRow, DiscoverySyncRunRow } from '@/domains/discovery/sync/repository';
import {
  claimSourceQueued,
  countSourceRecords,
  createDiscoverySyncRun,
  ensureDiscoverySource,
  failDiscoverySyncRunQueued,
  failQueuedClaim,
  getLatestDiscoverySyncRun,
  listDiscoverySyncRuns,
  recoverStaleDiscoverySyncRun,
  recoverStaleSourceRun,
  setSourceEnabled,
} from '@/domains/discovery/sync/repository';
import { db } from '@/infra/db';
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
 * Recover a lost `queued`/`syncing` run and keep run history synchronized with
 * the source row. Recovery is age-bounded and atomic, so a live run is never
 * misjudged; it only converts a stale claim into a visible timeout failure. It
 * never starts a new scan — a new run still requires an explicit admin trigger.
 *
 * A stale `queued` claim is additionally verified against queue liveness first:
 * a job still waiting in the queue owns the claim, so it is never failed. A
 * stale `syncing` run stays age-based only, because a live executor self-aborts
 * by its own 30-minute watchdog (PROJECT_GUTENBERG_SYNC_TIMEOUT_MS) and a Redis
 * `active` lock may outlive a dead worker — queue state is not proof of liveness
 * there, and the generation-fenced writes in the repository are the protection.
 *
 * When a recovery actually converts a stale claim, the run row of that exact
 * claim generation is closed with the same sanitized timeout summary in the
 * same transaction, so history and source status can never diverge.
 */
async function recoverStaleRun(source: DiscoverySourceRow): Promise<DiscoverySourceRow> {
  const queuedPastStaleAge =
    source.syncStatus === 'queued' && Date.now() - source.updatedAt.getTime() >= PROJECT_GUTENBERG_STALE_QUEUED_MS;
  if (queuedPastStaleAge && (await hasLiveQueuedJob(source))) {
    // A live job still owns this queued claim: leave it untouched.
    return source;
  }
  const now = new Date();
  // Capture the claim token of the stale queued row (if any) before recovery,
  // so the recovered run row gets the matching sanitized timeout summary.
  const queuedRecoveryToken = source.syncStatus === 'queued' && source.syncStartedAt ? source.syncStartedAt : null;
  const recovered = await db.transaction(async (tx) => {
    // Lock the source row first so a concurrently starting run cannot slip
    // between the recovery decision and its writes.
    const [locked] = await tx
      .select({ id: discoverySourceTable.id, syncStatus: discoverySourceTable.syncStatus })
      .from(discoverySourceTable)
      .where(eq(discoverySourceTable.id, source.id))
      .for('update');
    if (!locked) return null;
    const result = await recoverStaleSourceRun({
      sourceId: source.id,
      now,
      queuedStaleAfterMs: PROJECT_GUTENBERG_STALE_QUEUED_MS,
      syncingStaleAfterMs: PROJECT_GUTENBERG_STALE_SYNCING_MS,
      queuedErrorSummary: STALE_QUEUED_ERROR_SUMMARY,
      syncingErrorSummary: STALE_SYNCING_ERROR_SUMMARY,
      executor: tx,
    });
    if (result?.syncStartedAt) {
      // `syncStartedAt` is the claim/run generation token of the recovered run.
      const queuedRecovery = result.syncStartedAt.getTime() === (queuedRecoveryToken?.getTime() ?? -1);
      await recoverStaleDiscoverySyncRun({
        sourceId: source.id,
        claimToken: result.syncStartedAt,
        errorSummary: queuedRecovery ? STALE_QUEUED_ERROR_SUMMARY : STALE_SYNCING_ERROR_SUMMARY,
        finishedAt: now,
        executor: tx,
      });
    }
    return result;
  });
  if (recovered) {
    logger.warn(
      { sourceKey: source.sourceKey, syncStatus: recovered.syncStatus },
      'Recovered a stale Gutenberg metadata sync run as timed out',
    );
    const current = await loadProjectGutenbergSource();
    return current;
  }
  return source;
}

function toRunSummary(row: DiscoverySyncRunRow): DiscoverySyncRunSummary {
  return {
    id: row.id,
    stage: row.stage,
    queuedAt: row.queuedAt,
    startedAt: row.startedAt,
    lastActivityAt: row.lastActivityAt,
    finishedAt: row.finishedAt,
    committedRecords: row.committedRecords,
    committedBatches: row.committedBatches,
    unavailableRecords: row.unavailableRecords,
    errorSummary: row.errorSummary,
  };
}

/**
 * Conservative consumer evidence for a *queued* run, read from the dedicated
 * queue's real worker registrations. A waiting job alone is NOT evidence of a
 * consumer, so `unavailable` means "no registered worker right now" — not that
 * the queue is broken. Any Redis/queue error fails safe as `unknown`, which is
 * reported distinctly and never rendered as "no consumer" or as a failed queue.
 */
async function resolveQueuedConsumerState(): Promise<DiscoverySyncConsumerState> {
  try {
    const workers = await getDiscoverySyncQueue().getWorkers();
    return workers.length > 0 ? 'available' : 'unavailable';
  } catch (error) {
    logger.warn({ err: error }, 'Could not verify Gutenberg sync worker availability');
    return 'unknown';
  }
}

async function toRunProgress(
  source: DiscoverySourceRow,
  latestRun: DiscoverySyncRunRow | null,
): Promise<DiscoverySyncRunProgress> {
  const consumer: DiscoverySyncConsumerState =
    source.syncStatus === 'queued' && latestRun && latestRun.stage === 'queued'
      ? await resolveQueuedConsumerState()
      : 'unknown';
  return { run: latestRun ? toRunSummary(latestRun) : null, consumer };
}

function toSourceStatus(
  source: DiscoverySourceRow,
  recordCount: number,
  currentRun: DiscoverySyncRunProgress,
): DiscoverySourceStatus {
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
    currentRun,
  };
}

async function toStatus(source: DiscoverySourceRow): Promise<DiscoverySourceStatus> {
  const [recordCount, latestRun] = await Promise.all([
    countSourceRecords(source.id),
    getLatestDiscoverySyncRun(source.id),
  ]);
  return toSourceStatus(source, recordCount, await toRunProgress(source, latestRun));
}

async function loadProjectGutenbergSource(): Promise<DiscoverySourceRow> {
  return ensureDiscoverySource(PROJECT_GUTENBERG_SOURCE_KEY, PROJECT_GUTENBERG_SOURCE_TYPE);
}

/** Read-only admin status for the Project Gutenberg source. */
export async function getProjectGutenbergSourceStatus(): Promise<DiscoverySourceStatus> {
  return toStatus(await recoverStaleRun(await loadProjectGutenbergSource()));
}

/** Bounded recent-run history for the Project Gutenberg source (latest first). */
export async function getProjectGutenbergSyncRunHistory(): Promise<DiscoverySyncRunHistory> {
  const source = await loadProjectGutenbergSource();
  const runs = await listDiscoverySyncRuns(source.id);
  return { runs: runs.map(toRunSummary) };
}

/** Persist the admin enable/disable flag and return the resulting status. */
export async function setProjectGutenbergSourceEnabled(enabled: boolean): Promise<DiscoverySourceStatus> {
  const source = await loadProjectGutenbergSource();
  return toStatus(await setSourceEnabled(source.id, enabled));
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
  // Durable run row for this claim generation, created before the job is
  // enqueued so "queued but never started" is observable. Idempotent on the
  // claim token; the run's own guarded create is a no-op for the same token.
  await createDiscoverySyncRun({ sourceId: source.id, claimToken: claimedAt, now: new Date() });

  try {
    await enqueueDiscoverySync(
      JOB_DISCOVERY_SYNC,
      { sourceKey: PROJECT_GUTENBERG_SOURCE_KEY, claimedAt: claimedAt.toISOString() },
      { attempts: 1, jobId: discoverySyncJobId(PROJECT_GUTENBERG_SOURCE_KEY, claimedAt) },
    );
  } catch {
    // Sanitized summary only: enqueue failures may carry connection details.
    // Owner-guarded: only the exact claim issued above can be failed here, and
    // the run row closes with the same sanitized summary in one transaction.
    const finishedAt = new Date();
    await db.transaction(async (tx) => {
      const failed = await failQueuedClaim(
        source.id,
        claimedAt,
        'the Project Gutenberg metadata sync could not be queued',
        finishedAt,
        tx,
      );
      if (failed) {
        // The run row is closed with the same sanitized summary, fenced on the
        // same queued claim guard, in the same transaction: an enqueue failure
        // never reached `syncing`, so it is driven by the claim token alone.
        await failDiscoverySyncRunQueued({
          sourceId: source.id,
          claimToken: claimedAt,
          errorSummary: 'the Project Gutenberg metadata sync could not be queued',
          finishedAt,
          executor: tx,
        });
      }
    });
    logger.warn({ sourceKey: PROJECT_GUTENBERG_SOURCE_KEY }, 'Failed to enqueue Gutenberg metadata sync');
    throw new Error('Failed to enqueue the Project Gutenberg metadata sync');
  }

  logger.info({ sourceKey: PROJECT_GUTENBERG_SOURCE_KEY }, 'Gutenberg metadata sync enqueued');
  return { result: 'queued' };
}
