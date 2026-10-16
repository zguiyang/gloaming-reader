import { randomUUID } from 'node:crypto';

import { and, count, eq, inArray, isNotNull, isNull, lt, notInArray, or, sql } from 'drizzle-orm';

import type { SourceRecordAuthor, SourceRecordSourceMeta } from '@gloaming/db/schema';
import { discoverySource, sourceRecord } from '@gloaming/db/schema';

import type { ParsedSourceRecord } from '@/domains/discovery/gutenberg/rdf-record';
import { db, type DbTransaction } from '@/infra/db';

export type DiscoverySourceRow = typeof discoverySource.$inferSelect;

/** Creates the stable source row if missing, then returns it. */
export async function ensureDiscoverySource(sourceKey: string, sourceType: string): Promise<DiscoverySourceRow> {
  await db
    .insert(discoverySource)
    .values({ id: randomUUID(), sourceKey, sourceType })
    .onConflictDoNothing({ target: discoverySource.sourceKey });

  const [row] = await db.select().from(discoverySource).where(eq(discoverySource.sourceKey, sourceKey)).limit(1);
  if (!row) {
    throw new Error(`Failed to initialize discovery source "${sourceKey}"`);
  }
  return row;
}

/** Total SourceRecord rows owned by the source (available + unavailable). */
export async function countSourceRecords(sourceId: string): Promise<number> {
  const [row] = await db.select({ value: count() }).from(sourceRecord).where(eq(sourceRecord.sourceId, sourceId));
  return Number(row?.value ?? 0);
}

/**
 * Atomically claims a manual sync by moving a non-pending, enabled source to `queued`.
 * The returned Date is the claim's generation token: it is written to
 * `syncStartedAt`, and every later transition of this claim (`startSourceSyncing`,
 * `releaseSourceQueued`, `failQueuedClaim`) must present it again, so a job
 * holding a stale claim from a previous generation can never act on a row that
 * has since been recovered and re-claimed. Returns null when a run is already
 * queued/syncing or when the source is disabled, so a repeated trigger cannot
 * enqueue a duplicate concurrent snapshot sync and a disabled source cannot be
 * newly claimed.
 */
export async function claimSourceQueued(sourceId: string): Promise<Date | null> {
  const claimedAt = new Date();
  const result = await db
    .update(discoverySource)
    .set({ syncStatus: 'queued', syncStartedAt: claimedAt, lastErrorSummary: null })
    .where(
      and(
        eq(discoverySource.id, sourceId),
        eq(discoverySource.enabled, true),
        notInArray(discoverySource.syncStatus, ['queued', 'syncing']),
      ),
    );
  return (result.rowCount ?? 0) > 0 ? claimedAt : null;
}

/**
 * Clears a queued claim without running upstream, e.g. when the source was disabled
 * between enqueue and execution. Leaves the source `idle`; it is not an upstream
 * failure, so no error summary is recorded. Owner-guarded by the claim token
 * (`queued` + `syncStartedAt = claimedAt`), so an executor from an older
 * generation cannot release a newer claim. Preserves the previous
 * `syncFinishedAt` so Admin "Last sync" stays meaningful.
 */
export async function releaseSourceQueued(sourceId: string, claimedAt: Date): Promise<void> {
  await db
    .update(discoverySource)
    .set({ syncStatus: 'idle', syncStartedAt: null, lastErrorSummary: null })
    .where(
      and(
        eq(discoverySource.id, sourceId),
        eq(discoverySource.syncStatus, 'queued'),
        eq(discoverySource.syncStartedAt, claimedAt),
      ),
    );
}

/** Persists the admin enable/disable flag and returns the updated source row. */
export async function setSourceEnabled(sourceId: string, enabled: boolean): Promise<DiscoverySourceRow> {
  const [row] = await db.update(discoverySource).set({ enabled }).where(eq(discoverySource.id, sourceId)).returning();
  if (!row) {
    throw new Error('Failed to update discovery source enabled state');
  }
  return row;
}

export type StartSourceSyncOutcome = 'started' | 'disabled' | 'not-queued';

/**
 * Atomically starts a previously queued run. The single UPDATE matches
 * `enabled = true`, `syncStatus = 'queued'` and the claim generation token
 * `syncStartedAt = claimedAt` together, so a source disabled after queueing — or
 * a job whose claim belongs to an older, already recovered generation — cannot
 * begin fetching. On success the row's `syncStartedAt` becomes `startedAt`, the
 * run token that fences every terminal write of this run. A failed transition
 * reports whether the source is disabled or simply no longer queued, without
 * writing an error summary.
 */
export async function startSourceSyncing(
  sourceId: string,
  claimedAt: Date,
  startedAt: Date,
): Promise<StartSourceSyncOutcome> {
  const result = await db
    .update(discoverySource)
    .set({ syncStatus: 'syncing', syncStartedAt: startedAt, lastErrorSummary: null })
    .where(
      and(
        eq(discoverySource.id, sourceId),
        eq(discoverySource.enabled, true),
        eq(discoverySource.syncStatus, 'queued'),
        eq(discoverySource.syncStartedAt, claimedAt),
      ),
    );
  if ((result.rowCount ?? 0) > 0) {
    return 'started';
  }

  const [row] = await db
    .select({ enabled: discoverySource.enabled })
    .from(discoverySource)
    .where(eq(discoverySource.id, sourceId))
    .limit(1);
  return row && !row.enabled ? 'disabled' : 'not-queued';
}

/**
 * Reports a successful run. Fenced by generation: the UPDATE only applies while
 * the row still shows `syncing` with `syncStartedAt = runStartedAt` (the run
 * token captured when the run started), so a late success from an executor whose
 * run was recovered or replaced is a no-op instead of overwriting the current
 * run's state. Returns false when ownership was lost.
 */
export async function markSourceSucceeded(input: {
  sourceId: string;
  lastModified: string | null;
  finishedAt: Date;
  runStartedAt: Date;
}): Promise<boolean> {
  const result = await db
    .update(discoverySource)
    .set({
      syncStatus: 'succeeded',
      syncFinishedAt: input.finishedAt,
      lastSuccessAt: input.finishedAt,
      lastErrorSummary: null,
      ...(input.lastModified ? { snapshotLastModified: input.lastModified } : {}),
    })
    .where(
      and(
        eq(discoverySource.id, input.sourceId),
        eq(discoverySource.syncStatus, 'syncing'),
        eq(discoverySource.syncStartedAt, input.runStartedAt),
      ),
    );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Reports a failed run. Fenced by generation exactly like
 * {@link markSourceSucceeded}: only the current `syncing` run identified by
 * `runStartedAt` may record the failure, so a late error from a replaced
 * executor cannot overwrite the newer run's state. Returns false when
 * ownership was lost.
 */
export async function markSourceFailed(input: {
  sourceId: string;
  errorSummary: string;
  finishedAt: Date;
  runStartedAt: Date;
}): Promise<boolean> {
  const result = await db
    .update(discoverySource)
    .set({
      syncStatus: 'failed',
      syncFinishedAt: input.finishedAt,
      lastErrorSummary: input.errorSummary.slice(0, 500),
    })
    .where(
      and(
        eq(discoverySource.id, input.sourceId),
        eq(discoverySource.syncStatus, 'syncing'),
        eq(discoverySource.syncStartedAt, input.runStartedAt),
      ),
    );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Records an enqueue-stage failure for a claim that never started running.
 * Owner-guarded by the claim token (`queued` + `syncStartedAt = claimedAt`), so
 * it can only fail the exact claim the caller issued and never overwrites a row
 * that has already advanced to another run. Returns false when ownership was
 * lost.
 */
export async function failQueuedClaim(
  sourceId: string,
  claimedAt: Date,
  errorSummary: string,
  finishedAt: Date,
): Promise<boolean> {
  const result = await db
    .update(discoverySource)
    .set({
      syncStatus: 'failed',
      syncFinishedAt: finishedAt,
      lastErrorSummary: errorSummary.slice(0, 500),
    })
    .where(
      and(
        eq(discoverySource.id, sourceId),
        eq(discoverySource.syncStatus, 'queued'),
        eq(discoverySource.syncStartedAt, claimedAt),
      ),
    );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Marks a lost `queued`/`syncing` run as failed so the source cannot stay stuck
 * forever after a worker crash. Both transitions are single conditional UPDATEs
 * bound to the current status plus an age threshold, so a fresh queued claim or
 * a live run that is still within its limits is never misjudged, and the row can
 * be re-claimed only after this recovery has recorded the timeout failure.
 * Returns the updated row when a stale run was recovered, otherwise null.
 */
export async function recoverStaleSourceRun(input: {
  sourceId: string;
  now: Date;
  queuedStaleAfterMs: number;
  syncingStaleAfterMs: number;
  queuedErrorSummary: string;
  syncingErrorSummary: string;
}): Promise<DiscoverySourceRow | null> {
  const queuedBefore = new Date(input.now.getTime() - input.queuedStaleAfterMs);
  const recoveredQueued = await db
    .update(discoverySource)
    .set({
      syncStatus: 'failed',
      syncFinishedAt: input.now,
      lastErrorSummary: input.queuedErrorSummary.slice(0, 500),
    })
    .where(
      and(
        eq(discoverySource.id, input.sourceId),
        eq(discoverySource.syncStatus, 'queued'),
        lt(discoverySource.updatedAt, queuedBefore),
      ),
    )
    .returning();
  if (recoveredQueued[0]) {
    return recoveredQueued[0];
  }

  const syncingBefore = new Date(input.now.getTime() - input.syncingStaleAfterMs);
  const recoveredSyncing = await db
    .update(discoverySource)
    .set({
      syncStatus: 'failed',
      syncFinishedAt: input.now,
      lastErrorSummary: input.syncingErrorSummary.slice(0, 500),
    })
    .where(
      and(
        eq(discoverySource.id, input.sourceId),
        eq(discoverySource.syncStatus, 'syncing'),
        isNotNull(discoverySource.syncStartedAt),
        lt(discoverySource.syncStartedAt, syncingBefore),
      ),
    )
    .returning();
  return recoveredSyncing[0] ?? null;
}

/**
 * Idempotent multi-row upsert keyed by (source_id, external_id).
 * Only source-owned fields are updated; identity and createdAt are preserved.
 * Returns the stable row id per external id so the caller can key follow-up
 * classification state without another lookup.
 */
export async function upsertSourceRecords(
  sourceId: string,
  records: ParsedSourceRecord[],
  observedAt: Date,
  executor: typeof db | DbTransaction = db,
): Promise<Array<{ id: string; externalId: string }>> {
  if (records.length === 0) {
    return [];
  }

  return executor
    .insert(sourceRecord)
    .values(
      records.map((record) => ({
        id: randomUUID(),
        sourceId,
        externalId: record.externalId,
        title: record.title,
        authors: record.authors,
        languages: record.languages,
        description: record.description,
        rightsStatement: record.rightsStatement,
        coverUrl: record.coverUrl,
        contentCandidates: record.contentCandidates,
        sourceMeta: record.sourceMeta,
        availability: 'available' as const,
        sourceUpdatedAt: record.sourceUpdatedAt,
        lastSeenAt: observedAt,
      })),
    )
    .onConflictDoUpdate({
      target: [sourceRecord.sourceId, sourceRecord.externalId],
      set: {
        title: sql`excluded.title`,
        authors: sql`excluded.authors`,
        languages: sql`excluded.languages`,
        description: sql`excluded.description`,
        rightsStatement: sql`excluded.rights_statement`,
        coverUrl: sql`excluded.cover_url`,
        contentCandidates: sql`excluded.content_candidates`,
        sourceMeta: sql`excluded.source_meta`,
        availability: 'available',
        sourceUpdatedAt: sql`excluded.source_updated_at`,
        lastSeenAt: sql`excluded.last_seen_at`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: sourceRecord.id, externalId: sourceRecord.externalId });
}

export type SourceRecordClassificationEvidenceRow = {
  externalId: string;
  title: string;
  authors: SourceRecordAuthor[];
  languages: string[];
  description: string | null;
  sourceMeta: SourceRecordSourceMeta;
};

/**
 * Pre-upsert classification evidence for the requested external ids. The caller
 * compares it with the incoming snapshot to detect new or materially changed
 * records; the read is bounded to the current upsert batch.
 */
export async function loadClassificationEvidenceByExternalId(
  sourceId: string,
  externalIds: string[],
  executor: typeof db | DbTransaction = db,
): Promise<Map<string, SourceRecordClassificationEvidenceRow>> {
  if (externalIds.length === 0) return new Map();
  const rows = await executor
    .select({
      externalId: sourceRecord.externalId,
      title: sourceRecord.title,
      authors: sourceRecord.authors,
      languages: sourceRecord.languages,
      description: sourceRecord.description,
      sourceMeta: sourceRecord.sourceMeta,
    })
    .from(sourceRecord)
    .where(and(eq(sourceRecord.sourceId, sourceId), inArray(sourceRecord.externalId, externalIds)));
  return new Map(rows.map((row) => [row.externalId, row]));
}

/**
 * Marks records not observed in the completed snapshot as unavailable.
 * Never deletes records. Only valid after the full snapshot and every batch succeed.
 */
export async function reconcileUnavailableRecords(sourceId: string, observedAt: Date): Promise<number> {
  const result = await db
    .update(sourceRecord)
    .set({ availability: 'unavailable', updatedAt: new Date() })
    .where(
      and(
        eq(sourceRecord.sourceId, sourceId),
        or(isNull(sourceRecord.lastSeenAt), lt(sourceRecord.lastSeenAt, observedAt)),
      ),
    );
  return result.rowCount ?? 0;
}
