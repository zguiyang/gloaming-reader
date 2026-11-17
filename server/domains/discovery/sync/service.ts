import {
  PROJECT_GUTENBERG_CSV_SNAPSHOT_URL,
  PROJECT_GUTENBERG_SOURCE_KEY,
  PROJECT_GUTENBERG_SOURCE_TYPE,
} from '@/server/domains/discovery/gutenberg/constants';
import { openGutenbergCsvSnapshot, type CatalogEntryDraft } from '@/server/domains/discovery/gutenberg/csv-catalog';
import { GutenbergSnapshotError } from '@/server/domains/discovery/gutenberg/errors';
import { db } from '@/server/infra/db';
import { createLogger } from '@/server/infra/logging/logger';

import { estimateIndexBytesFromRowCount } from '@/server/domains/discovery/sync/index-size';

import {
  advanceDiscoverySyncRunStage,
  countProtectedSourceRecords,
  ensureDiscoverySource,
  finishDiscoverySyncRun,
  listTopCatalogEntriesForPromote,
  lockSourceRunOwnership,
  markSourceFailed,
  markSourceSucceeded,
  promoteSourceRecordsAtomically,
  releaseSourceQueued,
  SourceRunOwnershipLostError,
  startSourceSyncing,
  trimDiscoverySyncRunHistory,
  upsertCatalogEntriesBatch,
  type DiscoverySourceRow,
} from './repository';

const logger = createLogger('DiscoveryCatalogSync');

/** Staging / promote SQL batch size. */
const UPSERT_BATCH_SIZE = 500;

export type DiscoverySyncResult =
  | { status: 'not-modified'; lastModified: string | null }
  | { status: 'succeeded'; lastModified: string | null; counters: SyncCounters }
  | { status: 'skipped-disabled' }
  | { status: 'skipped-not-queued' }
  | { status: 'failed'; errorSummary: string };

type SyncCounters = {
  inserted: number;
  refreshed: number;
  evicted: number;
  skippedFilter: number;
};

function passesSourceFilters(entry: CatalogEntryDraft, source: DiscoverySourceRow): boolean {
  const allowed = new Set(source.languages.map((code) => code.toLowerCase()));
  if (!entry.languages.some((code) => allowed.has(code.toLowerCase()))) {
    return false;
  }
  if (source.requireEpub && !entry.hasEpub) {
    return false;
  }
  return true;
}

async function timed<T>(label: string, fields: Record<string, unknown>, work: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await work();
    logger.info({ ...fields, label, elapsedMs: Date.now() - startedAt }, 'Discovery sync step ok');
    return result;
  } catch (error) {
    logger.warn({ ...fields, label, elapsedMs: Date.now() - startedAt, err: error }, 'Discovery sync step failed');
    throw error;
  }
}

/**
 * Bounded Project Gutenberg catalog sync:
 * 1) CSV → `discovery_catalog_entry` (staging)
 * 2) Top-N promote → `source_record` (Discover index)
 *
 * Never downloads EPUB bytes or writes object storage.
 */
export async function syncProjectGutenbergCatalog(options: {
  signal?: AbortSignal;
  claimedAt: Date;
  force?: boolean;
}): Promise<DiscoverySyncResult> {
  const runWallStarted = Date.now();
  logger.info(
    {
      sourceKey: PROJECT_GUTENBERG_SOURCE_KEY,
      batchSize: UPSERT_BATCH_SIZE,
      force: options.force === true,
      claimedAt: options.claimedAt.toISOString(),
      snapshot: 'csv',
    },
    'Catalog sync begin',
  );

  const source = await timed('ensureDiscoverySource', {}, () =>
    ensureDiscoverySource(PROJECT_GUTENBERG_SOURCE_KEY, PROJECT_GUTENBERG_SOURCE_TYPE),
  );
  const claimedAt = options.claimedAt;
  const runStartedAt = new Date();

  const startOutcome = await timed('startSourceSyncing', { sourceId: source.id }, () =>
    startSourceSyncing(source.id, claimedAt, runStartedAt),
  );
  if (startOutcome !== 'started') {
    if (startOutcome === 'disabled') {
      const finishedAt = new Date();
      await db.transaction(async (tx) => {
        const released = await releaseSourceQueued(source.id, claimedAt, tx);
        if (released) {
          await finishDiscoverySyncRun({
            sourceId: source.id,
            claimToken: claimedAt,
            runStartedAt,
            stage: 'skipped',
            finishedAt,
            executor: tx,
          });
        }
      });
      return { status: 'skipped-disabled' };
    }
    return { status: 'skipped-not-queued' };
  }

  const runTokens = { sourceId: source.id, claimToken: claimedAt, runStartedAt };
  const counters: SyncCounters = { inserted: 0, refreshed: 0, evicted: 0, skippedFilter: 0 };

  try {
    const force = options.force === true;
    logger.info(
      {
        urlHost: new URL(PROJECT_GUTENBERG_CSV_SNAPSHOT_URL).host,
        conditional: !force && Boolean(source.snapshotLastModified),
        ifModifiedSince: force ? null : (source.snapshotLastModified ?? null),
      },
      'Catalog sync opening CSV snapshot',
    );

    const snapshot = await timed('openGutenbergCsvSnapshot', { force }, () =>
      openGutenbergCsvSnapshot({
        url: PROJECT_GUTENBERG_CSV_SNAPSHOT_URL,
        ifModifiedSince: force ? null : (source.snapshotLastModified ?? null),
        signal: options.signal,
      }),
    );

    if (!snapshot) {
      throwIfRunAborted(options.signal);
      const finishedAt = new Date();
      await db.transaction(async (tx) => {
        await finishDiscoverySyncRun({
          ...runTokens,
          stage: 'not_modified',
          finishedAt,
          counters,
          snapshotLastModified: source.snapshotLastModified ?? null,
          executor: tx,
        });
        const succeeded = await markSourceSucceeded({
          sourceId: source.id,
          lastModified: null,
          finishedAt,
          runStartedAt,
          executor: tx,
        });
        if (!succeeded) throw new SourceRunOwnershipLostError();
      });
      await trimDiscoverySyncRunHistory(source.id);
      logger.info({ elapsedMs: Date.now() - runWallStarted }, 'Catalog sync not_modified');
      return { status: 'not-modified', lastModified: source.snapshotLastModified ?? null };
    }

    await advanceDiscoverySyncRunStage({ ...runTokens, stage: 'processing' });

    const protectedCount = await timed('countProtectedSourceRecords', {}, () => countProtectedSourceRecords(source.id));
    if (protectedCount > source.maxRows) {
      throw new GutenbergSnapshotError(
        `protected index rows (${protectedCount}) exceed maxRows (${source.maxRows}); raise the cap or clean up linked records`,
      );
    }

    const observedAt = new Date();
    let kept = 0;
    const filtered: CatalogEntryDraft[] = [];
    for (const entry of snapshot.entries) {
      if (!passesSourceFilters(entry, source)) {
        counters.skippedFilter += 1;
        continue;
      }
      kept += 1;
      filtered.push(entry);
    }

    logger.info(
      {
        phase: 'ingest',
        csvRows: snapshot.entries.length,
        kept,
        skippedFilter: counters.skippedFilter,
        batchSize: UPSERT_BATCH_SIZE,
      },
      'Catalog sync CSV filtered; writing staging',
    );

    for (let i = 0; i < filtered.length; i += UPSERT_BATCH_SIZE) {
      throwIfRunAborted(options.signal);
      const batch = filtered.slice(i, i + UPSERT_BATCH_SIZE);
      const sqlStarted = Date.now();
      await db.transaction(async (tx) => {
        await lockSourceRunOwnership(tx, source.id, runStartedAt);
        await upsertCatalogEntriesBatch(source.id, batch, observedAt, tx);
      });
      if (i === 0 || (i + UPSERT_BATCH_SIZE) % 5_000 < UPSERT_BATCH_SIZE || i + UPSERT_BATCH_SIZE >= filtered.length) {
        logger.info(
          {
            op: 'stagingUpsertBatch',
            written: Math.min(i + batch.length, filtered.length),
            total: filtered.length,
            elapsedMs: Date.now() - sqlStarted,
          },
          'Catalog sync SQL batch',
        );
      }
    }

    const promoted = await timed('listTopCatalogEntriesForPromote', { maxRows: source.maxRows }, () =>
      listTopCatalogEntriesForPromote(source.id, source.maxRows, source.requireEpub),
    );
    if (promoted.length === 0) {
      throw new GutenbergSnapshotError('catalog staging produced no promotable rows');
    }

    // Soft budget gate uses row-count × fixed width (not pg_total_relation_size).
    const projectedBytes = estimateIndexBytesFromRowCount(promoted.length);
    if (projectedBytes > source.budgetBytesHint) {
      throw new GutenbergSnapshotError(
        `projected index size (${projectedBytes} bytes for ${promoted.length} rows) exceeds budget hint (${source.budgetBytesHint} bytes)`,
      );
    }

    logger.info(
      {
        phase: 'promote',
        promoted: promoted.length,
        maxRows: source.maxRows,
        projectedMiB: Math.round((projectedBytes / (1024 * 1024)) * 100) / 100,
      },
      'Catalog sync promoting Top-N into source_record (atomic)',
    );

    throwIfRunAborted(options.signal);
    const promoteResult = await timed('promoteSourceRecordsAtomically', { promoted: promoted.length }, () =>
      promoteSourceRecordsAtomically({
        sourceId: source.id,
        runStartedAt,
        records: promoted,
        observedAt,
        evictionPolicy: source.evictionPolicy,
        budgetBytesHint: source.budgetBytesHint,
      }),
    );
    counters.inserted += promoteResult.inserted;
    counters.refreshed += promoteResult.refreshed;
    counters.evicted += promoteResult.evicted;

    const lastModified = snapshot.lastModified;
    const finishedAt = new Date();
    await timed('finishSucceeded', { ...counters }, async () => {
      await db.transaction(async (tx) => {
        await finishDiscoverySyncRun({
          ...runTokens,
          stage: 'succeeded',
          finishedAt,
          counters,
          snapshotLastModified: lastModified,
          executor: tx,
        });
        const succeeded = await markSourceSucceeded({
          sourceId: source.id,
          lastModified,
          finishedAt,
          runStartedAt,
          executor: tx,
        });
        if (!succeeded) throw new SourceRunOwnershipLostError();
      });
      await trimDiscoverySyncRunHistory(source.id);
    });

    logger.info(
      {
        sourceKey: PROJECT_GUTENBERG_SOURCE_KEY,
        stagingKept: kept,
        promoted: promoted.length,
        batchSize: UPSERT_BATCH_SIZE,
        ...counters,
        lastModified,
        elapsedMs: Date.now() - runWallStarted,
      },
      'Gutenberg catalog sync succeeded',
    );
    return { status: 'succeeded', lastModified, counters };
  } catch (error) {
    if (error instanceof SourceRunOwnershipLostError) {
      return { status: 'skipped-not-queued' };
    }
    const errorSummary = toSyncErrorSummary(error, options.signal);
    try {
      const finishedAt = new Date();
      await db.transaction(async (tx) => {
        await finishDiscoverySyncRun({
          ...runTokens,
          stage: 'failed',
          finishedAt,
          counters,
          errorSummary,
          executor: tx,
        });
        const failed = await markSourceFailed({
          sourceId: source.id,
          errorSummary,
          finishedAt,
          runStartedAt,
          executor: tx,
        });
        if (!failed) throw new SourceRunOwnershipLostError();
      });
    } catch {
      logger.warn({ sourceKey: PROJECT_GUTENBERG_SOURCE_KEY }, 'Failed to persist catalog sync failure status');
    }
    logger.warn(
      { sourceKey: PROJECT_GUTENBERG_SOURCE_KEY, errorSummary, elapsedMs: Date.now() - runWallStarted },
      'Gutenberg catalog sync failed',
    );
    return { status: 'failed', errorSummary };
  }
}

function throwIfRunAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new GutenbergSnapshotError('the snapshot download was aborted');
  }
}

function toSyncErrorSummary(error: unknown, signal?: AbortSignal): string {
  if (signal?.aborted) {
    return 'the Project Gutenberg catalog sync exceeded its time limit';
  }
  if (error instanceof GutenbergSnapshotError) {
    return error.message;
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message.slice(0, 500);
  }
  return 'the Project Gutenberg catalog sync failed';
}
