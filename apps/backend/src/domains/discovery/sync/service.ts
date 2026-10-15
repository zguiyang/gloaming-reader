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
import { rootLogger } from '@/infra/logging/logger';

import {
  ensureDiscoverySource,
  loadClassificationEvidenceByExternalId,
  markSourceFailed,
  markSourceSucceeded,
  reconcileUnavailableRecords,
  releaseSourceQueued,
  type SourceRecordClassificationEvidenceRow,
  startSourceSyncing,
  upsertSourceRecords,
} from './repository';

const logger = rootLogger.child({ module: 'DiscoveryGutenbergSync' });

export { PROJECT_GUTENBERG_UPSERT_BATCH_SIZE };

export type DiscoverySyncResult =
  | { status: 'not-modified'; lastModified: string | null; seenRecords: 0; unavailableRecords: 0 }
  | {
      status: 'succeeded';
      lastModified: string | null;
      seenRecords: number;
      unavailableRecords: number;
      batches: number;
    }
  | { status: 'skipped-disabled' }
  | { status: 'skipped-not-queued' }
  | { status: 'failed'; errorSummary: string };

/**
 * Idempotent Project Gutenberg metadata sync.
 *
 * - metadata only: never creates ReadingWork/ReadingPart/ContentAsset/Library/ReadingState rows
 * - conditional refresh via Last-Modified / 304
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
}): Promise<DiscoverySyncResult> {
  const source = await ensureDiscoverySource(PROJECT_GUTENBERG_SOURCE_KEY, PROJECT_GUTENBERG_SOURCE_TYPE);
  const runStartedAt = new Date();
  const startOutcome = await startSourceSyncing(source.id, options.claimedAt, runStartedAt);
  if (startOutcome !== 'started') {
    if (startOutcome === 'disabled') {
      // Disabled between queueing and execution: release only the still-queued
      // claim without fetching upstream or recording an upstream failure.
      await releaseSourceQueued(source.id, options.claimedAt);
      logger.info({ sourceKey: PROJECT_GUTENBERG_SOURCE_KEY }, 'Gutenberg metadata sync skipped: source disabled');
      return { status: 'skipped-disabled' };
    }
    logger.info({ sourceKey: PROJECT_GUTENBERG_SOURCE_KEY }, 'Gutenberg metadata sync skipped: no owned queued claim');
    return { status: 'skipped-not-queued' };
  }

  let snapshot: GutenbergSnapshot | null = null;
  try {
    snapshot = await openGutenbergSnapshot({
      url: PROJECT_GUTENBERG_RDF_SNAPSHOT_URL,
      ifModifiedSince: source.snapshotLastModified ?? null,
      signal: options.signal,
    });

    if (!snapshot) {
      // Guard (c): never report success after the run was aborted.
      throwIfRunAborted(options.signal);
      const persisted = await markSourceSucceeded({
        sourceId: source.id,
        lastModified: null,
        finishedAt: new Date(),
        runStartedAt,
      });
      if (!persisted) {
        logger.warn(
          { sourceKey: PROJECT_GUTENBERG_SOURCE_KEY },
          'Gutenberg sync ownership lost; not-modified status not persisted',
        );
      }
      logger.info({ sourceKey: PROJECT_GUTENBERG_SOURCE_KEY }, 'Gutenberg snapshot not modified (304)');
      return {
        status: 'not-modified',
        lastModified: source.snapshotLastModified ?? null,
        seenRecords: 0,
        unavailableRecords: 0,
      };
    }

    const observedAt = new Date();
    const { seenRecords, batches } = await consumeSnapshot(source.id, snapshot, observedAt, options.signal);
    if (seenRecords === 0) {
      throw new GutenbergSnapshotError('the snapshot archive contained no RDF records');
    }

    // Guard (b): no reconciliation (a data write) once the run is aborted.
    throwIfRunAborted(options.signal);
    const unavailableRecords = await reconcileUnavailableRecords(source.id, observedAt);
    // Guard (d): no success report after the run was aborted.
    throwIfRunAborted(options.signal);
    const persisted = await markSourceSucceeded({
      sourceId: source.id,
      lastModified: snapshot.lastModified,
      finishedAt: new Date(),
      runStartedAt,
    });
    if (!persisted) {
      logger.warn(
        { sourceKey: PROJECT_GUTENBERG_SOURCE_KEY },
        'Gutenberg sync ownership lost; success status not persisted',
      );
    }

    logger.info(
      { sourceKey: PROJECT_GUTENBERG_SOURCE_KEY, seenRecords, unavailableRecords, batches },
      'Gutenberg metadata sync succeeded',
    );
    return {
      status: 'succeeded',
      lastModified: snapshot.lastModified,
      seenRecords,
      unavailableRecords,
      batches,
    };
  } catch (error) {
    const errorSummary = toSyncErrorSummary(error, options.signal);
    try {
      const persisted = await markSourceFailed({
        sourceId: source.id,
        errorSummary,
        finishedAt: new Date(),
        runStartedAt,
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
    logger.warn({ sourceKey: PROJECT_GUTENBERG_SOURCE_KEY, errorSummary }, 'Gutenberg metadata sync failed');
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

async function consumeSnapshot(
  sourceId: string,
  snapshot: GutenbergSnapshot,
  observedAt: Date,
  signal?: AbortSignal,
): Promise<{ seenRecords: number; batches: number }> {
  let seenRecords = 0;
  let batches = 0;
  let batch: ParsedSourceRecord[] = [];

  const flushBatch = async (): Promise<void> => {
    if (batch.length === 0) return;
    // Guard (a): an aborted run must not write any more data, even if the
    // pipeline keeps draining records after the abort.
    throwIfRunAborted(signal);
    const records = batch;
    batch = [];
    // Read pre-upsert evidence first so new/changed detection can baseline a
    // pre-existing record without reprocessing the whole corpus.
    const previousEvidence = await loadClassificationEvidenceByExternalId(
      sourceId,
      records.map((record) => record.externalId),
    );
    const upserted = await upsertSourceRecords(sourceId, records, observedAt);
    await registerIncrementalClassification(records, upserted, previousEvidence);
    seenRecords += records.length;
    batches += 1;
  };

  for await (const record of snapshot.records) {
    batch.push(record);
    if (batch.length >= PROJECT_GUTENBERG_UPSERT_BATCH_SIZE) {
      await flushBatch();
    }
  }
  await flushBatch();

  return { seenRecords, batches };
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
 * Best-effort incremental classification trigger. A failure here only skips the
 * trigger for this batch: source metadata is already persisted and the sync
 * result must not fail because classification bookkeeping could not be written.
 */
async function registerIncrementalClassification(
  records: ParsedSourceRecord[],
  upserted: Array<{ id: string; externalId: string }>,
  previousEvidence: Map<string, SourceRecordClassificationEvidenceRow>,
): Promise<void> {
  if (upserted.length === 0) return;
  try {
    const recordByExternalId = new Map(records.map((record) => [record.externalId, record]));
    const candidates = upserted.map((row) => {
      const record = recordByExternalId.get(row.externalId);
      if (!record) throw new Error(`Missing parsed source record for ${row.externalId}`);
      const previous = previousEvidence.get(row.externalId);
      return {
        sourceRecordId: row.id,
        fingerprint: computePublicClassificationFingerprint(toClassificationEvidence(record)),
        previousFingerprint: previous
          ? computePublicClassificationFingerprint(toClassificationEvidence(previous))
          : null,
        isNew: !previous,
      };
    });
    await recordPublicClassificationEvidenceBatch(candidates, new Date());
  } catch (error) {
    logger.warn(
      { err: error, sourceKey: PROJECT_GUTENBERG_SOURCE_KEY },
      'Incremental public classification trigger update failed',
    );
  }
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
