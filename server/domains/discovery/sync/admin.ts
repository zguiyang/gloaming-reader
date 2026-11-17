import { eq } from 'drizzle-orm';

import { JOB_DISCOVERY_SYNC } from '@/jobs/discovery-sync-contract';
import { discoverySource as discoverySourceTable } from '@/server/db/schema';
import {
  PROJECT_GUTENBERG_SOURCE_KEY,
  PROJECT_GUTENBERG_SOURCE_TYPE,
  PROJECT_GUTENBERG_STALE_QUEUED_MS,
  PROJECT_GUTENBERG_STALE_SYNCING_MS,
} from '@/server/domains/discovery/gutenberg/constants';
import {
  getRegisteredDiscoverySource,
  REGISTERED_DISCOVERY_SOURCES,
} from '@/server/domains/discovery/sources/registry';
import { db } from '@/server/infra/db';
import { createLogger } from '@/server/infra/logging/logger';
import { DISCOVERY_SYNC_QUEUE_NAME, enqueueDiscoverySync, getDiscoverySyncQueue } from '@/server/infra/queue';
import { NotFoundError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';
import type {
  DiscoverySourceSettingsUpdate,
  DiscoverySourceStatus,
  DiscoverySourceStatusListData,
  DiscoverySyncRunHistory,
  DiscoverySyncRunSummary,
  DiscoverySyncTriggerResultData,
} from '@/shared/discovery';

import {
  claimSourceQueued,
  countSourceRecords,
  createDiscoverySyncRun,
  ensureDiscoverySource,
  estimateIndexBytesForSource,
  failDiscoverySyncRunQueued,
  failQueuedClaim,
  listDiscoverySyncRuns,
  recoverStaleDiscoverySyncRun,
  recoverStaleSourceRun,
  updateDiscoverySourceSettings,
  type DiscoverySourceRow,
  type DiscoverySyncRunRow,
} from './repository';

const logger = createLogger('DiscoverySyncAdmin');

const STALE_QUEUED_ERROR_SUMMARY = 'the catalog sync was queued but never started (timed out)';
const STALE_SYNCING_ERROR_SUMMARY = 'the catalog sync exceeded its time limit';

export function discoverySyncJobId(sourceKey: string, claimedAt: Date): string {
  return `${JOB_DISCOVERY_SYNC}-${sourceKey}-${claimedAt.getTime()}`;
}

async function hasLiveQueuedJob(source: DiscoverySourceRow): Promise<boolean> {
  try {
    if (!source.syncStartedAt) return false;
    const job = await getDiscoverySyncQueue().getJob(discoverySyncJobId(source.sourceKey, source.syncStartedAt));
    if (!job) return false;
    const state = await job.getState();
    return state !== 'completed' && state !== 'failed';
  } catch (error) {
    logger.warn({ err: error, sourceKey: source.sourceKey }, 'Could not verify discovery sync queue liveness');
    return true;
  }
}

async function recoverStaleRun(source: DiscoverySourceRow): Promise<DiscoverySourceRow> {
  const queuedPastStaleAge =
    source.syncStatus === 'queued' && Date.now() - source.updatedAt.getTime() >= PROJECT_GUTENBERG_STALE_QUEUED_MS;
  if (queuedPastStaleAge && (await hasLiveQueuedJob(source))) {
    return source;
  }
  const now = new Date();
  const queuedRecoveryToken = source.syncStatus === 'queued' && source.syncStartedAt ? source.syncStartedAt : null;
  const recovered = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: discoverySourceTable.id })
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
  if (!recovered) return source;
  const [row] = await db.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, source.id)).limit(1);
  return row ?? source;
}

function toRunSummary(row: DiscoverySyncRunRow): DiscoverySyncRunSummary {
  return {
    id: row.id,
    stage: row.stage,
    queuedAt: row.queuedAt,
    finishedAt: row.finishedAt,
    inserted: row.inserted,
    refreshed: row.refreshed,
    evicted: row.evicted,
    skippedFilter: row.skippedFilter,
    errorSummary: row.errorSummary,
  };
}

async function toSourceStatus(source: DiscoverySourceRow): Promise<DiscoverySourceStatus> {
  const recordCount = await countSourceRecords(source.id);
  const indexBytes = await estimateIndexBytesForSource(source.id, recordCount);
  return {
    sourceKey: source.sourceKey,
    sourceType: source.sourceType,
    enabled: source.enabled,
    maxRows: source.maxRows,
    syncStatus: source.syncStatus,
    recordCount,
    lastSuccessAt: source.lastSuccessAt,
    lastErrorSummary: source.lastErrorSummary,
    estimatedIndexMiB: Math.round((indexBytes / (1024 * 1024)) * 100) / 100,
    budgetMiB: Math.round((source.budgetBytesHint / (1024 * 1024)) * 100) / 100,
  };
}

async function loadSourceRow(sourceKey: string): Promise<DiscoverySourceRow> {
  const registered = getRegisteredDiscoverySource(sourceKey);
  if (!registered) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.SOURCE_RECORD);
  }
  return ensureDiscoverySource(registered.sourceKey, registered.sourceType);
}

/** Admin: all registered sources with sync status and index counters. */
export async function listAdminDiscoverySourceStatuses(): Promise<DiscoverySourceStatusListData> {
  const items: DiscoverySourceStatus[] = [];
  for (const registered of REGISTERED_DISCOVERY_SOURCES) {
    const source = await recoverStaleRun(await loadSourceRow(registered.sourceKey));
    items.push(await toSourceStatus(source));
  }
  return { items };
}

export async function updateDiscoverySourceAdminSettings(
  sourceKey: string,
  patch: DiscoverySourceSettingsUpdate,
): Promise<DiscoverySourceStatus> {
  const source = await loadSourceRow(sourceKey);
  const updated = await updateDiscoverySourceSettings(source.id, patch);
  return toSourceStatus(updated);
}

export async function listDiscoverySourceSyncRuns(sourceKey: string): Promise<DiscoverySyncRunHistory> {
  const source = await loadSourceRow(sourceKey);
  const runs = await listDiscoverySyncRuns(source.id);
  return { runs: runs.map(toRunSummary) };
}

/**
 * Claim + enqueue a manual sync. Idempotent while a run is already queued/syncing.
 * Only Project Gutenberg implements catalog sync in v1.
 */
export async function triggerDiscoverySourceSync(
  sourceKey: string,
  input: { force?: boolean } = {},
): Promise<DiscoverySyncTriggerResultData> {
  if (sourceKey !== PROJECT_GUTENBERG_SOURCE_KEY) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.SOURCE_RECORD);
  }

  const force = input.force === true;
  const source = await recoverStaleRun(await ensureDiscoverySource(sourceKey, PROJECT_GUTENBERG_SOURCE_TYPE));
  if (!source.enabled) {
    return { result: 'disabled' };
  }

  const claimedAt = await claimSourceQueued(source.id);
  if (!claimedAt) {
    const current = await ensureDiscoverySource(sourceKey, PROJECT_GUTENBERG_SOURCE_TYPE);
    return { result: current.enabled ? 'already_running' : 'disabled' };
  }

  await createDiscoverySyncRun({ sourceId: source.id, claimToken: claimedAt, now: new Date() });

  try {
    await enqueueDiscoverySync(
      JOB_DISCOVERY_SYNC,
      {
        sourceKey,
        claimedAt: claimedAt.toISOString(),
        ...(force ? { force: true } : {}),
      },
      { attempts: 1, jobId: discoverySyncJobId(sourceKey, claimedAt) },
    );
  } catch {
    const finishedAt = new Date();
    await db.transaction(async (tx) => {
      const failed = await failQueuedClaim(
        source.id,
        claimedAt,
        'the catalog sync could not be queued',
        finishedAt,
        tx,
      );
      if (failed) {
        await failDiscoverySyncRunQueued({
          sourceId: source.id,
          claimToken: claimedAt,
          errorSummary: 'the catalog sync could not be queued',
          finishedAt,
          executor: tx,
        });
      }
    });
    throw new Error('Failed to enqueue the discovery catalog sync');
  }

  logger.info({ sourceKey, queue: DISCOVERY_SYNC_QUEUE_NAME }, 'Discovery catalog sync enqueued');
  return { result: 'queued' };
}

/** Schedule hook: claim in-worker and run sync without a second enqueue. */
export async function claimScheduledDiscoverySync(sourceKey: string): Promise<Date | null> {
  if (sourceKey !== PROJECT_GUTENBERG_SOURCE_KEY) {
    return null;
  }
  const source = await recoverStaleRun(await ensureDiscoverySource(sourceKey, PROJECT_GUTENBERG_SOURCE_TYPE));
  if (!source.enabled) {
    return null;
  }
  const claimedAt = await claimSourceQueued(source.id);
  if (!claimedAt) {
    return null;
  }
  await createDiscoverySyncRun({ sourceId: source.id, claimToken: claimedAt, now: new Date() });
  return claimedAt;
}
