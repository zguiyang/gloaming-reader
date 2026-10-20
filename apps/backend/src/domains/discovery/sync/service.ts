import type { SourceRecordAuthor, SourceRecordSourceMeta } from '@gloaming/db/schema';

import {
  computePublicClassificationFingerprint,
  type PublicClassificationEvidence,
  recordPublicClassificationEvidenceBatch,
} from '@/domains/discovery/categories';
import {
  PROJECT_GUTENBERG_RDF_SNAPSHOT_URL,
  PROJECT_GUTENBERG_SOURCE_KEY,
  PROJECT_GUTENBERG_SOURCE_TYPE,
  PROJECT_GUTENBERG_UPSERT_BATCH_SIZE,
} from '@/domains/discovery/gutenberg/constants';
import { GutenbergSnapshotError } from '@/domains/discovery/gutenberg/errors';
import type { ParsedSourceRecord } from '@/domains/discovery/gutenberg/rdf-record';
import type { GutenbergSnapshot } from '@/domains/discovery/gutenberg/snapshot-stream';
import { openGutenbergSnapshot } from '@/domains/discovery/gutenberg/snapshot-stream';
import { db, type DbTransaction } from '@/infra/db';
import { rootLogger } from '@/infra/logging/logger';

import {
  advanceDiscoverySyncRunStage,
  ensureDiscoverySource,
  finishDiscoverySyncRunFailed,
  finishDiscoverySyncRunSkipped,
  finishDiscoverySyncRunSucceeded,
  loadClassificationEvidenceByExternalId,
  lockSourceRunOwnership,
  markSourceFailed,
  markSourceSucceeded,
  reconcileUnavailableRecords,
  recordDiscoverySyncRunBatchProgress,
  releaseSourceQueued,
  type SourceRecordClassificationEvidenceRow,
  SourceRunOwnershipLostError,
  startSourceSyncing,
  upsertSourceRecords,
} from './repository';

const logger = rootLogger.child({ module: 'DiscoveryGutenbergSync' });

export { PROJECT_GUTENBERG_UPSERT_BATCH_SIZE };

export type DiscoverySyncResult =
  | {
      status: 'not-modified';
      lastModified: string | null;
      seenRecords: 0;
      unavailableRecords: 0;
      committedRecords: 0;
      committedBatches: 0;
    }
  | {
      status: 'succeeded';
      lastModified: string | null;
      seenRecords: number;
      unavailableRecords: number;
      batches: number;
      committedRecords: number;
    }
  | { status: 'skipped-disabled' }
  | { status: 'skipped-not-queued' }
  | { status: 'failed'; errorSummary: string };

/**
 * Idempotent Project Gutenberg metadata sync.
 *
 * - metadata only: never creates ReadingWork/ReadingPart/ContentAsset/Library/ReadingState rows
 * - conditional refresh via Last-Modified / 304, unless `force` re-requests the
 *   snapshot unconditionally (no `If-Modified-Since`) for a full reparse
 * - records are never deleted; absence is reconciled only after the full snapshot succeeds
 * - a run starts only through the atomic enabled+queued transition, guarded by
 *   the claim generation token `claimedAt`; a disabled or no-longer-owned job
 *   skips without fetching upstream
 * - once the run's abort signal fires (e.g. the time limit), no further data is
 *   written and no success is reported; every terminal write is fenced by the
 *   run token so a replaced executor cannot overwrite a newer run
 */
export async function syncProjectGutenbergMetadata(options: {
  signal?: AbortSignal;
  claimedAt: Date;
  /**
   * Explicit admin opt-in to a full refresh: request the snapshot with no
   * `If-Modified-Since` so a fixed parser reprocesses every historical record.
   * Only the literal `true` enables it; every other value keeps the stored
   * Last-Modified conditional request.
   */
  force?: boolean;
}): Promise<DiscoverySyncResult> {
  const source = await ensureDiscoverySource(PROJECT_GUTENBERG_SOURCE_KEY, PROJECT_GUTENBERG_SOURCE_TYPE);
  const claimedAt = options.claimedAt;
  const runStartedAt = new Date();
  // The durable run row is created inside `claimSourceQueued`'s transaction
  // (and `startSourceSyncing` backfills a pre-migration queued task), so this
  // executor never fabricates history before genuinely owning the claim.
  const startOutcome = await startSourceSyncing(source.id, claimedAt, runStartedAt);
  if (startOutcome !== 'started') {
    if (startOutcome === 'disabled') {
      // Disabled between queueing and execution: release only the still-queued
      // claim without fetching upstream or recording an upstream failure, and
      // close that same generation's run row in one transaction.
      const finishedAt = new Date();
      await db.transaction(async (tx) => {
        // Release only the still-owned queued claim; if the source already
        // moved on (no match) this executor owns nothing, so no run is closed.
        const released = await releaseSourceQueued(source.id, claimedAt, tx);
        if (released) {
          await finishDiscoverySyncRunSkipped({ sourceId: source.id, claimToken: claimedAt, finishedAt, executor: tx });
        }
      });
      logger.info({ sourceKey: PROJECT_GUTENBERG_SOURCE_KEY }, 'Gutenberg metadata sync skipped: source disabled');
      return { status: 'skipped-disabled' };
    }
    // The claim belongs to an older generation: no run row was ever created
    // for it by this executor, so there is no history to close or fabricate.
    logger.info({ sourceKey: PROJECT_GUTENBERG_SOURCE_KEY }, 'Gutenberg metadata sync skipped: no owned queued claim');
    return { status: 'skipped-not-queued' };
  }
  // From here on the run is owned by this executor: `claimedAt` identifies the
  // run row, `runStartedAt` identifies the source-row generation.
  const runTokens = { sourceId: source.id, claimToken: claimedAt, startToken: runStartedAt };

  // Observability counter for legitimately skipped non-ebook RDF members
  // (generator/metadata files). Suspected ebook members that fail parsing
  // throw and fail the run before reconciliation.
  let skippedNonEbookMembers = 0;
  let snapshot: GutenbergSnapshot | null = null;
  try {
    // `force` drops the conditional header so upstream cannot answer 304 for a
    // snapshot already stored; reconciliation, run records, and classification
    // evidence then follow the exact same path as a normal full download.
    const force = options.force === true;
    snapshot = await openGutenbergSnapshot({
      url: PROJECT_GUTENBERG_RDF_SNAPSHOT_URL,
      ifModifiedSince: force ? null : (source.snapshotLastModified ?? null),
      signal: options.signal,
      onNonEbookMemberSkipped: () => {
        skippedNonEbookMembers += 1;
      },
    });

    if (!snapshot) {
      // Guard (c): never report success after the run was aborted.
      throwIfRunAborted(options.signal);
      const finishedAt = new Date();
      await db.transaction(async (tx) => {
        // A 304 is a successful outcome (nothing to reconcile); the run's
        // terminal state commits with the source status so history and source
        // row cannot diverge. `finishDiscoverySyncRunSucceeded` verifies and
        // locks the source (still `syncing`) first, then the source flips.
        await finishDiscoverySyncRunSucceeded({
          ...runTokens,
          stage: 'not_modified',
          unavailableRecords: 0,
          snapshotLastModified: source.snapshotLastModified ?? null,
          finishedAt,
          executor: tx,
        });
        const succeeded = await markSourceSucceeded({
          sourceId: source.id,
          lastModified: null,
          finishedAt,
          runStartedAt,
          executor: tx,
        });
        // Losing the source token rolls the run's terminal write back too.
        if (!succeeded) throw new SourceRunOwnershipLostError();
      });
      logger.info({ sourceKey: PROJECT_GUTENBERG_SOURCE_KEY }, 'Gutenberg snapshot not modified (304)');
      return {
        status: 'not-modified',
        lastModified: source.snapshotLastModified ?? null,
        seenRecords: 0,
        unavailableRecords: 0,
        committedRecords: 0,
        committedBatches: 0,
      };
    }

    const observedAt = new Date();
    const { seenRecords, batches, committedRecords } = await consumeSnapshot({
      sourceId: source.id,
      runTokens,
      snapshot,
      observedAt,
      signal: options.signal,
    });
    if (seenRecords === 0) {
      throw new GutenbergSnapshotError('the snapshot archive contained no RDF records');
    }

    // Guard (b): no reconciliation (a data write) once the run is aborted.
    throwIfRunAborted(options.signal);
    await advanceDiscoverySyncRunStage({ ...runTokens, stage: 'reconciling', now: new Date() });
    const lastModified = snapshot.lastModified;
    // Reconcile and the success report commit together under a source-row lock,
    // so a run that already lost its token can neither flip availability nor
    // report success for a generation it no longer owns.
    const unavailableRecords = await db.transaction(async (tx) => {
      const reconciled = await reconcileUnavailableRecords(source.id, observedAt, tx, runStartedAt);
      // Guard (d): no success report after the run was aborted; rolling the
      // transaction back also undoes the reconciliation above.
      throwIfRunAborted(options.signal);
      // The run's terminal state is written and the source locked (still
      // `syncing`) first, then the source flips; losing the source token rolls
      // the run's terminal write back in the same transaction.
      await finishDiscoverySyncRunSucceeded({
        ...runTokens,
        stage: 'succeeded',
        unavailableRecords: reconciled,
        snapshotLastModified: lastModified,
        finishedAt: new Date(),
        executor: tx,
      });
      const persisted = await markSourceSucceeded({
        sourceId: source.id,
        lastModified: lastModified,
        finishedAt: new Date(),
        runStartedAt,
        executor: tx,
      });
      if (!persisted) {
        throw new SourceRunOwnershipLostError();
      }
      return reconciled;
    });

    logger.info(
      { sourceKey: PROJECT_GUTENBERG_SOURCE_KEY, seenRecords, unavailableRecords, batches, skippedNonEbookMembers },
      'Gutenberg metadata sync succeeded',
    );
    return {
      status: 'succeeded',
      lastModified: snapshot.lastModified,
      seenRecords,
      unavailableRecords,
      batches,
      committedRecords,
    };
  } catch (error) {
    if (error instanceof SourceRunOwnershipLostError) {
      // This run no longer owns the source row: the current batch/final
      // transaction was rolled back while previously committed batches remain,
      // and the new run's terminal state must stay untouched, so skip without
      // recording a failure for the current generation.
      logger.info(
        { sourceKey: PROJECT_GUTENBERG_SOURCE_KEY },
        'Gutenberg sync skipped: run ownership lost before the terminal write',
      );
      return { status: 'skipped-not-queued' };
    }
    const errorSummary = toSyncErrorSummary(error, options.signal);
    try {
      const finishedAt = new Date();
      const persisted = await db.transaction(async (tx) => {
        // Verify the source-row lock and write the run's terminal state first,
        // then record the source failure in the same transaction: any lost
        // ownership rolls both writes back together, and sharing `tx` avoids
        // deadlocking a second connection against the lock this one holds.
        const runFailed = await finishDiscoverySyncRunFailed({
          ...runTokens,
          errorSummary,
          finishedAt,
          executor: tx,
        });
        if (!runFailed) {
          return false;
        }
        const sourceFailed = await markSourceFailed({
          sourceId: source.id,
          errorSummary,
          finishedAt,
          runStartedAt,
          executor: tx,
        });
        // Losing the source token rolls the run's terminal write back too, so
        // history and source status can never diverge into a half-terminal state.
        if (!sourceFailed) throw new SourceRunOwnershipLostError();
        return true;
      });
      if (!persisted) {
        logger.warn(
          { sourceKey: PROJECT_GUTENBERG_SOURCE_KEY },
          'Gutenberg sync ownership lost; failure status not persisted',
        );
      }
    } catch {
      logger.warn({ sourceKey: PROJECT_GUTENBERG_SOURCE_KEY }, 'Failed to persist Gutenberg sync failure status');
    }
    logger.warn(
      { sourceKey: PROJECT_GUTENBERG_SOURCE_KEY, errorSummary, skippedNonEbookMembers },
      'Gutenberg metadata sync failed',
    );
    return { status: 'failed', errorSummary };
  } finally {
    snapshot?.close();
  }
}

/**
 * Aborts the run once its signal fired (e.g. the sync time limit). The thrown
 * error is a `GutenbergSnapshotError`, and `toSyncErrorSummary` maps an aborted
 * signal to the sanitized time-limit summary.
 */
function throwIfRunAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new GutenbergSnapshotError('the snapshot download was aborted');
  }
}

async function consumeSnapshot(input: {
  sourceId: string;
  runTokens: { claimToken: Date; startToken: Date };
  snapshot: GutenbergSnapshot;
  observedAt: Date;
  signal?: AbortSignal;
}): Promise<{ seenRecords: number; batches: number; committedRecords: number }> {
  const { sourceId, runTokens, snapshot, observedAt, signal } = input;
  const runStartedAt = runTokens.startToken;
  let seenRecords = 0;
  let batches = 0;
  let committedRecords = 0;
  let batch: ParsedSourceRecord[] = [];

  const flushBatch = async (): Promise<void> => {
    if (batch.length === 0) return;
    // Guard (a): an aborted run must not write any more data, even if the
    // pipeline keeps draining records after the abort.
    throwIfRunAborted(signal);
    const records = batch;
    batch = [];
    // Metadata and its classification decision must commit together. Otherwise
    // an identical retry can mistake lost new/changed evidence for legacy data.
    await db.transaction(async (tx) => {
      const previousEvidence = await loadClassificationEvidenceByExternalId(
        sourceId,
        records.map((record) => record.externalId),
        tx,
      );
      throwIfRunAborted(signal);
      // Lock the source row before any write and hold it to commit: a run whose
      // token was replaced must not persist metadata or classification state.
      await lockSourceRunOwnership(tx, sourceId, runStartedAt);
      const upserted = await upsertSourceRecords(sourceId, records, observedAt, tx);
      throwIfRunAborted(signal);
      await registerIncrementalClassification(records, upserted, previousEvidence, tx);
      throwIfRunAborted(signal);
      // Progress advances inside the batch transaction: a rolled-back batch
      // rolls this increment back too, so counters only ever count committed work.
      await recordDiscoverySyncRunBatchProgress({
        sourceId,
        claimToken: runTokens.claimToken,
        startToken: runTokens.startToken,
        committedRecords: records.length,
        now: new Date(),
        executor: tx,
      });
    });
    seenRecords += records.length;
    committedRecords += records.length;
    batches += 1;
  };

  let stageAdvanced = false;
  for await (const record of snapshot.records) {
    if (!stageAdvanced) {
      // The first parsed record is the first truthful evidence of processing.
      await advanceDiscoverySyncRunStage({
        sourceId,
        ...runTokens,
        stage: 'processing',
        now: new Date(),
      });
      stageAdvanced = true;
    }
    batch.push(record);
    if (batch.length >= PROJECT_GUTENBERG_UPSERT_BATCH_SIZE) {
      await flushBatch();
    }
  }
  await flushBatch();

  return { seenRecords, batches, committedRecords };
}

function toClassificationEvidence(input: {
  title: string;
  authors: SourceRecordAuthor[];
  languages: string[];
  description: string | null;
  sourceMeta: SourceRecordSourceMeta;
}): PublicClassificationEvidence {
  return {
    title: input.title,
    authors: input.authors.map((author) => author.name),
    languages: input.languages,
    description: input.description,
    subjects: input.sourceMeta.subjects ?? [],
    bookshelves: input.sourceMeta.bookshelves ?? [],
  };
}

/**
 * Persist the classification decision inside the metadata batch transaction.
 * A bookkeeping failure rolls back the batch and fails this sync so identical
 * snapshot retries can still detect the original new/changed evidence.
 */
async function registerIncrementalClassification(
  records: ParsedSourceRecord[],
  upserted: Array<{ id: string; externalId: string }>,
  previousEvidence: Map<string, SourceRecordClassificationEvidenceRow>,
  executor: DbTransaction,
): Promise<void> {
  if (upserted.length === 0) return;
  const recordByExternalId = new Map(records.map((record) => [record.externalId, record]));
  const candidates = upserted.map((row) => {
    const record = recordByExternalId.get(row.externalId);
    if (!record) throw new Error(`Missing parsed source record for ${row.externalId}`);
    const previous = previousEvidence.get(row.externalId);
    return {
      sourceRecordId: row.id,
      fingerprint: computePublicClassificationFingerprint(toClassificationEvidence(record)),
      previousFingerprint: previous ? computePublicClassificationFingerprint(toClassificationEvidence(previous)) : null,
      isNew: !previous,
    };
  });
  await recordPublicClassificationEvidenceBatch(candidates, new Date(), executor);
}

function toSyncErrorSummary(error: unknown, signal?: AbortSignal): string {
  if (signal?.aborted) {
    return 'the Project Gutenberg metadata sync exceeded its time limit';
  }
  if (error instanceof GutenbergSnapshotError) {
    return error.message.slice(0, 300);
  }
  if (error instanceof Error) {
    return `the Project Gutenberg metadata sync failed with ${error.name}`;
  }
  return 'the Project Gutenberg metadata sync failed';
}
