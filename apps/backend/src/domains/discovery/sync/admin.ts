import { randomUUID } from 'node:crypto';

import type { DiscoverySourceStatus, DiscoverySyncAccepted } from '@gloaming/shared/discovery';

import { JOB_DISCOVERY_SYNC } from '@/application/jobs/discovery-sync';
import { PROJECT_GUTENBERG_SOURCE_KEY, PROJECT_GUTENBERG_SOURCE_TYPE } from '@/domains/discovery/gutenberg/constants';
import type { DiscoverySourceRow } from '@/domains/discovery/sync/repository';
import {
  claimSourceQueued,
  countSourceRecords,
  ensureDiscoverySource,
  markSourceFailed,
  setSourceEnabled,
} from '@/domains/discovery/sync/repository';
import { rootLogger } from '@/infra/logging/logger';
import { enqueue } from '@/infra/queue';

const logger = rootLogger.child({ module: 'DiscoverySourceAdmin' });

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
  const source = await loadProjectGutenbergSource();
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
 * `already_running` instead of stacking jobs.
 */
export async function requestProjectGutenbergSync(): Promise<DiscoverySyncAccepted> {
  const source = await loadProjectGutenbergSource();
  if (!source.enabled) {
    return { result: 'disabled' };
  }
  if (!(await claimSourceQueued(source.id))) {
    // Re-read: the source may have been disabled between the check and the claim.
    const current = await loadProjectGutenbergSource();
    return { result: current.enabled ? 'already_running' : 'disabled' };
  }

  try {
    await enqueue(
      JOB_DISCOVERY_SYNC,
      { sourceKey: PROJECT_GUTENBERG_SOURCE_KEY },
      { attempts: 1, jobId: `${JOB_DISCOVERY_SYNC}:${PROJECT_GUTENBERG_SOURCE_KEY}:${randomUUID()}` },
    );
  } catch {
    // Sanitized summary only: enqueue failures may carry connection details.
    await markSourceFailed({
      sourceId: source.id,
      errorSummary: 'the Project Gutenberg metadata sync could not be queued',
      finishedAt: new Date(),
    });
    logger.warn({ sourceKey: PROJECT_GUTENBERG_SOURCE_KEY }, 'Failed to enqueue Gutenberg metadata sync');
    throw new Error('Failed to enqueue the Project Gutenberg metadata sync');
  }

  logger.info({ sourceKey: PROJECT_GUTENBERG_SOURCE_KEY }, 'Gutenberg metadata sync enqueued');
  return { result: 'queued' };
}
