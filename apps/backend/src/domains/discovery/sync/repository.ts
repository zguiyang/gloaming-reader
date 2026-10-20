import { randomUUID } from 'node:crypto';

import { and, count, desc, eq, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql } from 'drizzle-orm';

import type { SourceRecordAuthor, SourceRecordSourceMeta } from '@gloaming/db/schema';
import {
  DISCOVERY_SYNC_RUN_HISTORY_LIMIT,
  DISCOVERY_SYNC_RUN_TERMINAL_STAGES,
  discoverySource,
  discoverySyncRun,
  type DiscoverySyncRunStage,
  isDiscoverySyncRunTerminalStage,
  readingWork,
  sourceRecord,
} from '@gloaming/db/schema';

import type { ParsedSourceRecord } from '@/domains/discovery/gutenberg/rdf-record';
import { db, type DbTransaction } from '@/infra/db';

export type DiscoverySourceRow = typeof discoverySource.$inferSelect;
export type DiscoverySyncRunRow = typeof discoverySyncRun.$inferSelect;

/** Raised when this run's token no longer owns the source row and no write may proceed. */
export class SourceRunOwnershipLostError extends Error {
  constructor() {
    super('the discovery source run no longer owns its claim');
    this.name = 'SourceRunOwnershipLostError';
  }
}

/**
 * Locks the source row for the rest of the transaction and verifies it still
 * shows `syncing` for this run's token. The FOR UPDATE lock is held until the
 * transaction commits or rolls back, so a recovery that replaces the run token
 * cannot interleave between the check and the writes that follow it.
 */
export async function lockSourceRunOwnership(
  executor: DbTransaction,
  sourceId: string,
  runStartedAt: Date,
): Promise<void> {
  const [row] = await executor
    .select({ syncStatus: discoverySource.syncStatus, syncStartedAt: discoverySource.syncStartedAt })
    .from(discoverySource)
    .where(eq(discoverySource.id, sourceId))
    .for('update');
  if (!row || row.syncStatus !== 'syncing' || row.syncStartedAt?.getTime() !== runStartedAt.getTime()) {
    throw new SourceRunOwnershipLostError();
  }
}

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
  return db.transaction(async (tx) => {
    const result = await tx
      .update(discoverySource)
      .set({ syncStatus: 'queued', syncStartedAt: claimedAt, lastErrorSummary: null })
      .where(
        and(
          eq(discoverySource.id, sourceId),
          eq(discoverySource.enabled, true),
          notInArray(discoverySource.syncStatus, ['queued', 'syncing']),
        ),
      );
    if ((result.rowCount ?? 0) === 0) return null;
    // The run row commits atomically with the claim so a claimed generation
    // can never be left without its durable observability record.
    await createDiscoverySyncRun({ sourceId, claimToken: claimedAt, now: claimedAt, executor: tx });
    return claimedAt;
  });
}

/**
 * Clears a queued claim without running upstream, e.g. when the source was disabled
 * between enqueue and execution. Leaves the source `idle`; it is not an upstream
 * failure, so no error summary is recorded. Owner-guarded by the claim token
 * (`queued` + `syncStartedAt = claimedAt`), so an executor from an older
 * generation cannot release a newer claim. Preserves the previous
 * `syncFinishedAt` so Admin "Last sync" stays meaningful.
 */
export async function releaseSourceQueued(
  sourceId: string,
  claimedAt: Date,
  executor: typeof db | DbTransaction = db,
): Promise<boolean> {
  const result = await executor
    .update(discoverySource)
    .set({ syncStatus: 'idle', syncStartedAt: null, lastErrorSummary: null })
    .where(
      and(
        eq(discoverySource.id, sourceId),
        eq(discoverySource.syncStatus, 'queued'),
        eq(discoverySource.syncStartedAt, claimedAt),
      ),
    );
  return (result.rowCount ?? 0) > 0;
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
  return db.transaction(async (tx) => {
    const result = await tx
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
      // A pre-migration queued task may have no run row yet: create it now that
      // the claim is genuinely owned, never for an unknown/old job.
      await createDiscoverySyncRun({ sourceId, claimToken: claimedAt, now: claimedAt, executor: tx });
      const startedRun = await markDiscoverySyncRunStarted({
        sourceId,
        claimToken: claimedAt,
        startedAt,
        executor: tx,
      });
      // The run row must advance with the source transition; a fencing failure
      // here rolls the whole start back so source and run cannot diverge.
      if (!startedRun) throw new SourceRunOwnershipLostError();
      return 'started' as const;
    }

    const [row] = await tx
      .select({ enabled: discoverySource.enabled })
      .from(discoverySource)
      .where(eq(discoverySource.id, sourceId))
      .limit(1);
    return (row && !row.enabled ? 'disabled' : 'not-queued') as StartSourceSyncOutcome;
  });
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
  executor?: typeof db | DbTransaction;
}): Promise<boolean> {
  const executor = input.executor ?? db;
  const result = await executor
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
  /** Executor of an open transaction that already holds the source-row lock. */
  executor?: typeof db | DbTransaction;
}): Promise<boolean> {
  const executor = input.executor ?? db;
  const result = await executor
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
  executor: typeof db | DbTransaction = db,
): Promise<boolean> {
  const result = await executor
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
 * `syncStartedAt` is returned because it is the claim/run generation token.
 * Returns the updated row when a stale run was recovered, otherwise null.
 */
export async function recoverStaleSourceRun(input: {
  sourceId: string;
  now: Date;
  queuedStaleAfterMs: number;
  syncingStaleAfterMs: number;
  queuedErrorSummary: string;
  syncingErrorSummary: string;
  /** Executor of an open transaction that already holds the source-row lock. */
  executor?: typeof db | DbTransaction;
}): Promise<Pick<DiscoverySourceRow, 'syncStatus' | 'syncStartedAt'> | null> {
  const executor = input.executor ?? db;
  const queuedBefore = new Date(input.now.getTime() - input.queuedStaleAfterMs);
  const recoveredQueued = await executor
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
    .returning({ syncStatus: discoverySource.syncStatus, syncStartedAt: discoverySource.syncStartedAt });
  if (recoveredQueued[0]) {
    return recoveredQueued[0];
  }

  const syncingBefore = new Date(input.now.getTime() - input.syncingStaleAfterMs);
  const recoveredSyncing = await executor
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
    .returning({ syncStatus: discoverySource.syncStatus, syncStartedAt: discoverySource.syncStartedAt });
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

export type SourceRecordWorkMetadataBaselineRow = {
  workId: string | null;
  title: string;
  description: string | null;
  /** `reading_work.origin_meta.sourceCoverUrl` of the linked Work, or null when none is recorded. */
  sourceCoverUrl: string | null;
};

/**
 * Pre-upsert work metadata baseline for the requested external ids: the stored
 * title/description (to compare against the incoming snapshot), the optional
 * linked Work, and that Work's recorded source-cover marker (so a changed
 * source cover is detected in the same bounded read). Mirrors
 * {@link loadClassificationEvidenceByExternalId}: one bounded batch read per
 * upsert batch instead of per-row queries.
 */
export async function loadWorkMetadataBaselineByExternalId(
  sourceId: string,
  externalIds: string[],
  executor: typeof db | DbTransaction = db,
): Promise<Map<string, SourceRecordWorkMetadataBaselineRow>> {
  if (externalIds.length === 0) return new Map();
  const rows = await executor
    .select({
      externalId: sourceRecord.externalId,
      workId: sourceRecord.workId,
      title: sourceRecord.title,
      description: sourceRecord.description,
      sourceCoverUrl: sql<string | null>`${readingWork.originMeta} ->> 'sourceCoverUrl'`,
    })
    .from(sourceRecord)
    .leftJoin(readingWork, eq(sourceRecord.workId, readingWork.id))
    .where(and(eq(sourceRecord.sourceId, sourceId), inArray(sourceRecord.externalId, externalIds)));
  return new Map(
    rows.map((row) => [
      row.externalId,
      { workId: row.workId, title: row.title, description: row.description, sourceCoverUrl: row.sourceCoverUrl },
    ]),
  );
}

/**
 * Copies synchronized title/description onto already-materialized Works inside
 * the caller's batch transaction (product decision 2026-10-20). Only title and
 * description are written — author, cover, parts, reading progress, and user
 * tags are never touched. Bounded by the upsert batch: one guarded UPDATE per
 * changed linked record.
 *
 * - same value → no write (the WHERE clause keeps `updated_at` untouched)
 * - a missing Work row (dangling/deleted link) matches nothing and is skipped
 * - a Work in `processing_status = 'failed'` is never force-written
 *
 * Returns how many Work rows were actually updated.
 */
export async function updateLinkedWorkMetadata(
  updates: Array<{ workId: string; title: string; description: string }>,
  executor: DbTransaction,
): Promise<number> {
  let updated = 0;
  for (const update of updates) {
    const result = await executor
      .update(readingWork)
      .set({ title: update.title, description: update.description })
      .where(
        and(
          eq(readingWork.id, update.workId),
          ne(readingWork.processingStatus, 'failed'),
          or(ne(readingWork.title, update.title), ne(readingWork.description, update.description)),
        ),
      );
    updated += result.rowCount ?? 0;
  }
  return updated;
}

/**
 * Marks records not observed in the completed snapshot as unavailable.
 * Never deletes records. Only valid after the full snapshot and every batch succeed.
 * When `runStartedAt` is supplied, the source row is locked and ownership is
 * verified inside the caller's transaction first, so a replaced run can never
 * flip availability; losing the token raises {@link SourceRunOwnershipLostError}
 * before any availability write.
 */
export async function reconcileUnavailableRecords(
  sourceId: string,
  observedAt: Date,
  executor: typeof db | DbTransaction = db,
  runStartedAt?: Date,
): Promise<number> {
  if (runStartedAt) {
    await lockSourceRunOwnership(executor as DbTransaction, sourceId, runStartedAt);
  }
  const result = await executor
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

/**
 * Creates the durable observability row for one claimed sync run. Called right
 * after `claimSourceQueued` succeeds, so every claimed generation — even one
 * that never starts — has a truthful `queued` run instead of fabricated
 * history. Idempotent on the `(source_id, claim_token)` key: a repeated call for
 * the same claim token returns the existing row without touching it.
 */
export async function createDiscoverySyncRun(input: {
  sourceId: string;
  claimToken: Date;
  now: Date;
  /** Executor of an open transaction so the run row commits atomically with the claim. */
  executor?: typeof db | DbTransaction;
}): Promise<DiscoverySyncRunRow> {
  const executor = input.executor ?? db;
  const [row] = await executor
    .insert(discoverySyncRun)
    .values({
      id: randomUUID(),
      sourceId: input.sourceId,
      claimToken: input.claimToken,
      stage: 'queued',
      queuedAt: input.now,
      lastActivityAt: input.now,
    })
    .onConflictDoNothing({ target: [discoverySyncRun.sourceId, discoverySyncRun.claimToken] })
    .returning();
  if (row) return row;
  const [existing] = await executor
    .select()
    .from(discoverySyncRun)
    .where(and(eq(discoverySyncRun.sourceId, input.sourceId), eq(discoverySyncRun.claimToken, input.claimToken)))
    .limit(1);
  if (!existing) {
    throw new Error('Failed to create the discovery sync run record');
  }
  return existing;
}

/**
 * Returns the latest tracked run for a source, or null when none exists yet.
 * Old claims recorded before run tracking existed have no row — history is
 * never fabricated for them.
 */
export async function getLatestDiscoverySyncRun(sourceId: string): Promise<DiscoverySyncRunRow | null> {
  const [row] = await db
    .select()
    .from(discoverySyncRun)
    .where(eq(discoverySyncRun.sourceId, sourceId))
    .orderBy(desc(discoverySyncRun.queuedAt), desc(discoverySyncRun.claimToken))
    .limit(1);
  return row ?? null;
}

/** Bounded recent-run history, latest first. */
export async function listDiscoverySyncRuns(
  sourceId: string,
  limit: number = DISCOVERY_SYNC_RUN_HISTORY_LIMIT,
): Promise<DiscoverySyncRunRow[]> {
  return db
    .select()
    .from(discoverySyncRun)
    .where(eq(discoverySyncRun.sourceId, sourceId))
    .orderBy(desc(discoverySyncRun.queuedAt), desc(discoverySyncRun.claimToken))
    .limit(Math.max(1, Math.min(limit, DISCOVERY_SYNC_RUN_HISTORY_LIMIT)));
}

/**
 * Locks the run row for the rest of the transaction and verifies it still
 * belongs to this run generation (`claim_token = claimedAt`). The FOR UPDATE
 * lock is held to commit, exactly like {@link lockSourceRunOwnership}, so
 * progress writes of two generations can never interleave.
 */
async function lockDiscoverySyncRunOwnership(
  executor: DbTransaction,
  sourceId: string,
  claimToken: Date,
): Promise<void> {
  const [row] = await executor
    .select({ claimToken: discoverySyncRun.claimToken, stage: discoverySyncRun.stage })
    .from(discoverySyncRun)
    .where(and(eq(discoverySyncRun.sourceId, sourceId), eq(discoverySyncRun.claimToken, claimToken)))
    .for('update');
  if (!row || row.claimToken.getTime() !== claimToken.getTime() || isDiscoverySyncRunTerminalStage(row.stage)) {
    throw new SourceRunOwnershipLostError();
  }
}

/**
 * Marks the run as executing. Runs inside the same transaction as
 * `startSourceSyncing`, so the run row's `start_token` becomes the executor's
 * `runStartedAt` and every later progress write of this generation presents
 * both tokens. Fenced by the claim token: a superseded queued claim is a no-op
 * (returns false) instead of resurrecting an old run row.
 */
export async function markDiscoverySyncRunStarted(input: {
  sourceId: string;
  claimToken: Date;
  startedAt: Date;
  executor: DbTransaction;
}): Promise<boolean> {
  const result = await input.executor
    .update(discoverySyncRun)
    .set({
      stage: 'downloading',
      startToken: input.startedAt,
      startedAt: input.startedAt,
      lastActivityAt: input.startedAt,
    })
    .where(
      and(
        eq(discoverySyncRun.sourceId, input.sourceId),
        eq(discoverySyncRun.claimToken, input.claimToken),
        eq(discoverySyncRun.stage, 'queued'),
      ),
    );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Advances a live run to a new phase. All tokens must match and the run must
 * still be non-terminal, so a stale executor cannot rewind or re-label another
 * generation's run. Truthful activity: a phase transition is a real event.
 */
export async function advanceDiscoverySyncRunStage(input: {
  sourceId: string;
  claimToken: Date;
  startToken: Date;
  stage: Extract<DiscoverySyncRunStage, 'processing' | 'reconciling'>;
  now: Date;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await lockSourceRunOwnership(tx, input.sourceId, input.startToken);
    await lockDiscoverySyncRunOwnership(tx, input.sourceId, input.claimToken);
    await tx
      .update(discoverySyncRun)
      .set({ stage: input.stage, lastActivityAt: input.now })
      .where(eq(discoverySyncRun.id, await currentRunId(tx, input.sourceId, input.claimToken)));
  });
}

async function currentRunId(executor: DbTransaction, sourceId: string, claimToken: Date): Promise<string> {
  const [row] = await executor
    .select({ id: discoverySyncRun.id })
    .from(discoverySyncRun)
    .where(and(eq(discoverySyncRun.sourceId, sourceId), eq(discoverySyncRun.claimToken, claimToken)))
    .limit(1);
  if (!row) throw new SourceRunOwnershipLostError();
  return row.id;
}

/**
 * Records one committed batch of the current run, inside the caller's already
 * open batch transaction. Because it shares that transaction, a batch that
 * rolls back rolls this increment back too — failed batches never advance
 * progress. Both the source-row lock (already held by the caller's
 * `lockSourceRunOwnership`) and the run tokens are verified, so a stale
 * executor from an older generation cannot inflate another run's counters.
 */
export async function recordDiscoverySyncRunBatchProgress(input: {
  sourceId: string;
  claimToken: Date;
  startToken: Date;
  committedRecords: number;
  now: Date;
  executor: DbTransaction;
}): Promise<void> {
  if (input.committedRecords <= 0) return;
  await lockDiscoverySyncRunOwnership(input.executor, input.sourceId, input.claimToken);
  const [row] = await input.executor
    .select({ startToken: discoverySyncRun.startToken, stage: discoverySyncRun.stage })
    .from(discoverySyncRun)
    .where(and(eq(discoverySyncRun.sourceId, input.sourceId), eq(discoverySyncRun.claimToken, input.claimToken)))
    .limit(1);
  if (!row || row.startToken?.getTime() !== input.startToken.getTime() || isDiscoverySyncRunTerminalStage(row.stage)) {
    throw new SourceRunOwnershipLostError();
  }
  await input.executor
    .update(discoverySyncRun)
    .set({
      committedRecords: sql`${discoverySyncRun.committedRecords} + ${input.committedRecords}`,
      committedBatches: sql`${discoverySyncRun.committedBatches} + 1`,
      lastActivityAt: input.now,
    })
    .where(eq(discoverySyncRun.id, await currentRunId(input.executor, input.sourceId, input.claimToken)));
}

/**
 * Terminal write for a completed run, executed inside the same transaction as
 * `markSourceSucceeded` so run history and source status commit together. It
 * re-verifies the source row's ownership, so losing the generation rolls the
 * success report back together with the reconciliation.
 */
export async function finishDiscoverySyncRunSucceeded(input: {
  sourceId: string;
  claimToken: Date;
  startToken: Date;
  stage: Extract<DiscoverySyncRunStage, 'succeeded' | 'not_modified'>;
  unavailableRecords: number;
  snapshotLastModified: string | null;
  finishedAt: Date;
  executor: DbTransaction;
}): Promise<void> {
  await lockSourceRunOwnership(input.executor, input.sourceId, input.startToken);
  await lockDiscoverySyncRunOwnership(input.executor, input.sourceId, input.claimToken);
  await finishRun(input.executor, {
    sourceId: input.sourceId,
    claimToken: input.claimToken,
    stage: input.stage,
    unavailableRecords: input.unavailableRecords,
    snapshotLastModified: input.snapshotLastModified,
    finishedAt: input.finishedAt,
  });
}

/**
 * Terminal write for a run that failed; fenced by both run tokens. Returns false when ownership was lost.
 * When `executor` is supplied it must be the caller's already-open transaction
 * (which may hold the source-row lock): re-entering `db.transaction` on another
 * connection would deadlock against that lock, so the fenced writes run directly
 * in the supplied executor and only fall back to their own transaction when no
 * executor was given.
 */
export async function finishDiscoverySyncRunFailed(input: {
  sourceId: string;
  claimToken: Date;
  startToken: Date;
  errorSummary: string;
  finishedAt: Date;
  /** Executor of an open transaction that already holds the source-row lock. */
  executor?: DbTransaction;
}): Promise<boolean> {
  const run = async (tx: DbTransaction): Promise<boolean> => {
    // A replaced generation must not record a failure for a run it no longer owns.
    await lockSourceRunOwnership(tx, input.sourceId, input.startToken);
    await lockDiscoverySyncRunOwnership(tx, input.sourceId, input.claimToken);
    const [row] = await tx
      .select({ startToken: discoverySyncRun.startToken, stage: discoverySyncRun.stage })
      .from(discoverySyncRun)
      .where(and(eq(discoverySyncRun.sourceId, input.sourceId), eq(discoverySyncRun.claimToken, input.claimToken)))
      .limit(1);
    if (
      !row ||
      row.startToken?.getTime() !== input.startToken.getTime() ||
      isDiscoverySyncRunTerminalStage(row.stage)
    ) {
      return false;
    }
    await finishRun(tx, {
      sourceId: input.sourceId,
      claimToken: input.claimToken,
      stage: 'failed',
      errorSummary: input.errorSummary,
      finishedAt: input.finishedAt,
    });
    return true;
  };
  if (input.executor) {
    return run(input.executor);
  }
  return db.transaction(async (tx) => run(tx));
}

/**
 * Closes the run for an enqueue-stage failure, fenced on the still-queued
 * claim (`stage = 'queued'`) so it can only fail the exact claim that was just
 * issued and never a run that already started or finished. Returns false when
 * the run no longer matches (already terminal or a different generation).
 */
export async function failDiscoverySyncRunQueued(input: {
  sourceId: string;
  claimToken: Date;
  errorSummary: string;
  finishedAt: Date;
  executor: DbTransaction;
}): Promise<boolean> {
  const result = await input.executor
    .update(discoverySyncRun)
    .set({
      stage: 'failed',
      finishedAt: input.finishedAt,
      lastActivityAt: input.finishedAt,
      errorSummary: input.errorSummary.slice(0, 500),
    })
    .where(
      and(
        eq(discoverySyncRun.sourceId, input.sourceId),
        eq(discoverySyncRun.claimToken, input.claimToken),
        eq(discoverySyncRun.stage, 'queued'),
      ),
    );
  return (result.rowCount ?? 0) > 0;
}

/** Terminal write for a run that ended without fetching upstream (disabled or superseded claim). */
export async function finishDiscoverySyncRunSkipped(input: {
  sourceId: string;
  claimToken: Date;
  finishedAt: Date;
  /** Executor of an open transaction so the skipped run commits with the source release. */
  executor?: DbTransaction;
}): Promise<void> {
  const run = async (tx: DbTransaction): Promise<void> => {
    // No-op when the run row is missing (pre-migration legacy) or already
    // terminal: skipping a superseded claim must never resurrect or throw.
    const [row] = await tx
      .select({ id: discoverySyncRun.id, stage: discoverySyncRun.stage })
      .from(discoverySyncRun)
      .where(and(eq(discoverySyncRun.sourceId, input.sourceId), eq(discoverySyncRun.claimToken, input.claimToken)))
      .for('update')
      .limit(1);
    if (!row || isDiscoverySyncRunTerminalStage(row.stage)) return;
    await tx
      .update(discoverySyncRun)
      .set({
        stage: 'skipped',
        finishedAt: input.finishedAt,
        lastActivityAt: input.finishedAt,
        errorSummary: null,
      })
      .where(eq(discoverySyncRun.id, row.id));
  };
  if (input.executor) {
    await run(input.executor);
    return;
  }
  await db.transaction(run);
}

type FinishRunInput = {
  sourceId: string;
  claimToken: Date;
  stage: Extract<DiscoverySyncRunStage, 'succeeded' | 'not_modified' | 'skipped' | 'failed'>;
  finishedAt: Date;
  errorSummary?: string;
  unavailableRecords?: number;
  snapshotLastModified?: string | null;
};

async function finishRun(executor: DbTransaction, input: FinishRunInput): Promise<void> {
  await executor
    .update(discoverySyncRun)
    .set({
      stage: input.stage,
      finishedAt: input.finishedAt,
      lastActivityAt: input.finishedAt,
      errorSummary: input.errorSummary ? input.errorSummary.slice(0, 500) : null,
      ...(input.unavailableRecords !== undefined ? { unavailableRecords: input.unavailableRecords } : {}),
      ...(input.snapshotLastModified !== undefined ? { snapshotLastModified: input.snapshotLastModified } : {}),
    })
    .where(
      and(
        eq(discoverySyncRun.sourceId, input.sourceId),
        eq(discoverySyncRun.claimToken, input.claimToken),
        notInArray(discoverySyncRun.stage, [...DISCOVERY_SYNC_RUN_TERMINAL_STAGES]),
      ),
    );
}

/**
 * Age-bounded recovery for a run row whose claim went stale without a terminal
 * write (e.g. the worker died mid-run). Fenced to the exact claim token, so a
 * live or already-finished run is never rewritten. Mirrors the source-row
 * recovery so run history and source status stay synchronized.
 */
export async function recoverStaleDiscoverySyncRun(input: {
  sourceId: string;
  /** The stale generation token: a queued claim's token or a syncing run's start token. */
  claimToken: Date;
  errorSummary: string;
  finishedAt: Date;
  /** Executor of an open transaction that already holds the source-row lock. */
  executor?: DbTransaction;
}): Promise<void> {
  const run = async (tx: DbTransaction): Promise<void> => {
    // A syncing recovery presents the run's start token, while a queued recovery
    // presents the claim token; match either so the correct run row is found.
    const [row] = await tx
      .select({ id: discoverySyncRun.id, stage: discoverySyncRun.stage })
      .from(discoverySyncRun)
      .where(
        and(
          eq(discoverySyncRun.sourceId, input.sourceId),
          or(eq(discoverySyncRun.claimToken, input.claimToken), eq(discoverySyncRun.startToken, input.claimToken)),
        ),
      )
      .for('update')
      .limit(1);
    // No run row: a pre-migration untracked task. Return without fabricating
    // history and without blocking the source-row recovery in the same tx.
    if (!row || isDiscoverySyncRunTerminalStage(row.stage)) return;
    await tx
      .update(discoverySyncRun)
      .set({
        stage: 'failed',
        finishedAt: input.finishedAt,
        lastActivityAt: input.finishedAt,
        errorSummary: input.errorSummary.slice(0, 500),
      })
      .where(eq(discoverySyncRun.id, row.id));
  };
  if (input.executor) {
    await run(input.executor);
    return;
  }
  await db.transaction(run);
}
