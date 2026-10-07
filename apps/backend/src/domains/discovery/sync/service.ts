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
  markSourceFailed,
  markSourceSucceeded,
  reconcileUnavailableRecords,
  releaseSourceQueued,
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
 * - a run starts only through the atomic enabled+queued transition; a disabled or
 *   no-longer-queued job skips without fetching upstream
 */
export async function syncProjectGutenbergMetadata(
  options: { signal?: AbortSignal } = {},
): Promise<DiscoverySyncResult> {
  const source = await ensureDiscoverySource(PROJECT_GUTENBERG_SOURCE_KEY, PROJECT_GUTENBERG_SOURCE_TYPE);
  const startOutcome = await startSourceSyncing(source.id, new Date());
  if (startOutcome !== 'started') {
    if (startOutcome === 'disabled') {
      // Disabled between queueing and execution: release only the still-queued
      // claim without fetching upstream or recording an upstream failure.
      await releaseSourceQueued(source.id);
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
      await markSourceSucceeded({ sourceId: source.id, lastModified: null, finishedAt: new Date() });
      logger.info({ sourceKey: PROJECT_GUTENBERG_SOURCE_KEY }, 'Gutenberg snapshot not modified (304)');
      return {
        status: 'not-modified',
        lastModified: source.snapshotLastModified ?? null,
        seenRecords: 0,
        unavailableRecords: 0,
      };
    }

    const observedAt = new Date();
    const { seenRecords, batches } = await consumeSnapshot(source.id, snapshot, observedAt);
    if (seenRecords === 0) {
      throw new GutenbergSnapshotError('the snapshot archive contained no RDF records');
    }

    const unavailableRecords = await reconcileUnavailableRecords(source.id, observedAt);
    await markSourceSucceeded({ sourceId: source.id, lastModified: snapshot.lastModified, finishedAt: new Date() });

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
      await markSourceFailed({ sourceId: source.id, errorSummary, finishedAt: new Date() });
    } catch {
      logger.warn({ sourceKey: PROJECT_GUTENBERG_SOURCE_KEY }, 'Failed to persist Gutenberg sync failure status');
    }
    logger.warn({ sourceKey: PROJECT_GUTENBERG_SOURCE_KEY, errorSummary }, 'Gutenberg metadata sync failed');
    return { status: 'failed', errorSummary };
  } finally {
    snapshot?.close();
  }
}

async function consumeSnapshot(
  sourceId: string,
  snapshot: GutenbergSnapshot,
  observedAt: Date,
): Promise<{ seenRecords: number; batches: number }> {
  let seenRecords = 0;
  let batches = 0;
  let batch: ParsedSourceRecord[] = [];

  for await (const record of snapshot.records) {
    batch.push(record);
    if (batch.length >= PROJECT_GUTENBERG_UPSERT_BATCH_SIZE) {
      await upsertSourceRecords(sourceId, batch, observedAt);
      seenRecords += batch.length;
      batches += 1;
      batch = [];
    }
  }

  if (batch.length > 0) {
    await upsertSourceRecords(sourceId, batch, observedAt);
    seenRecords += batch.length;
    batches += 1;
  }

  return { seenRecords, batches };
}

function toSyncErrorSummary(error: unknown, signal?: AbortSignal): string {
  if (signal?.aborted) {
    return 'the Project Gutenberg metadata sync was aborted';
  }
  if (error instanceof GutenbergSnapshotError) {
    return error.message.slice(0, 300);
  }
  if (error instanceof Error) {
    return `the Project Gutenberg metadata sync failed with ${error.name}`;
  }
  return 'the Project Gutenberg metadata sync failed';
}
