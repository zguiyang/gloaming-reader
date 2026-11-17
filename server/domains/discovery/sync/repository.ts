import { randomUUID } from 'node:crypto';

import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  lt,
  notExists,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';

import {
  discoveryCatalogEntry,
  discoverySource,
  discoverySyncRun,
  type DiscoverySyncRunStage,
  sourceRecord,
  sourceRecordSaveIntent,
} from '@/server/db/schema';
import type { CatalogEntryDraft } from '@/server/domains/discovery/gutenberg/csv-catalog';
import type { ParsedSourceRecord } from '@/server/domains/discovery/gutenberg/rdf-record';
import { estimateIndexBytesFromRowCount } from '@/server/domains/discovery/sync/index-size';
import { ensureDiscoverySource } from '@/server/domains/discovery/persist/source-record';
import { db, type DbTransaction } from '@/server/infra/db';
import { DISCOVERY_SYNC_RUN_HISTORY_LIMIT } from '@/shared/discovery';

export { ensureDiscoverySource };

export type DiscoverySourceRow = typeof discoverySource.$inferSelect;
export type DiscoverySyncRunRow = typeof discoverySyncRun.$inferSelect;

const TERMINAL_RUN_STAGES: readonly DiscoverySyncRunStage[] = ['succeeded', 'not_modified', 'skipped', 'failed'];

export function isDiscoverySyncRunTerminalStage(stage: DiscoverySyncRunStage): boolean {
  return (TERMINAL_RUN_STAGES as readonly string[]).includes(stage);
}

/** Raised when this run's token no longer owns the source row and no write may proceed. */
export class SourceRunOwnershipLostError extends Error {
  constructor() {
    super('the discovery source run no longer owns its claim');
    this.name = 'SourceRunOwnershipLostError';
  }
}

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

export async function countSourceRecords(sourceId: string, executor: typeof db | DbTransaction = db): Promise<number> {
  const [row] = await executor.select({ value: count() }).from(sourceRecord).where(eq(sourceRecord.sourceId, sourceId));
  return Number(row?.value ?? 0);
}

/** Rows that must not be hot-swapped away (linked Work, materialization, or pending Save). */
export async function countProtectedSourceRecords(sourceId: string): Promise<number> {
  const pendingIntent = db
    .select({ id: sourceRecordSaveIntent.id })
    .from(sourceRecordSaveIntent)
    .where(
      and(eq(sourceRecordSaveIntent.sourceRecordId, sourceRecord.id), eq(sourceRecordSaveIntent.status, 'pending')),
    );
  const [row] = await db
    .select({ value: count() })
    .from(sourceRecord)
    .where(
      and(
        eq(sourceRecord.sourceId, sourceId),
        or(
          isNotNull(sourceRecord.workId),
          inArray(sourceRecord.materializationStatus, ['processing', 'ready']),
          exists(pendingIntent),
        ),
      ),
    );
  return Number(row?.value ?? 0);
}

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
    await createDiscoverySyncRun({ sourceId, claimToken: claimedAt, now: claimedAt, executor: tx });
    return claimedAt;
  });
}

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

export type StartSourceSyncOutcome = 'started' | 'disabled' | 'not-queued';

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
      await createDiscoverySyncRun({ sourceId, claimToken: claimedAt, now: claimedAt, executor: tx });
      const startedRun = await markDiscoverySyncRunStarted({
        sourceId,
        claimToken: claimedAt,
        startedAt,
        executor: tx,
      });
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

export async function markSourceFailed(input: {
  sourceId: string;
  errorSummary: string;
  finishedAt: Date;
  runStartedAt: Date;
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

export async function recoverStaleSourceRun(input: {
  sourceId: string;
  now: Date;
  queuedStaleAfterMs: number;
  syncingStaleAfterMs: number;
  queuedErrorSummary: string;
  syncingErrorSummary: string;
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
  if (recoveredQueued[0]) return recoveredQueued[0];

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

export async function updateDiscoverySourceSettings(
  sourceId: string,
  patch: { enabled?: boolean; maxRows?: number },
): Promise<DiscoverySourceRow> {
  const [row] = await db.update(discoverySource).set(patch).where(eq(discoverySource.id, sourceId)).returning();
  if (!row) throw new Error('Failed to update discovery source settings');
  return row;
}

export async function loadIndexedExternalIds(sourceId: string): Promise<Set<string>> {
  const rows = await db
    .select({ externalId: sourceRecord.externalId })
    .from(sourceRecord)
    .where(eq(sourceRecord.sourceId, sourceId));
  return new Set(rows.map((row) => row.externalId));
}

export async function findExistingExternalIds(
  sourceId: string,
  externalIds: string[],
  executor: typeof db | DbTransaction = db,
): Promise<Set<string>> {
  if (externalIds.length === 0) return new Set();
  const rows = await executor
    .select({ externalId: sourceRecord.externalId })
    .from(sourceRecord)
    .where(and(eq(sourceRecord.sourceId, sourceId), inArray(sourceRecord.externalId, externalIds)));
  return new Set(rows.map((row) => row.externalId));
}

export async function upsertSourceRecordsBatch(
  sourceId: string,
  records: ParsedSourceRecord[],
  observedAt: Date,
  executor: typeof db | DbTransaction = db,
): Promise<{ inserted: number; refreshed: number }> {
  if (records.length === 0) return { inserted: 0, refreshed: 0 };

  const externalIds = records.map((r) => r.externalId);
  const existing = await findExistingExternalIds(sourceId, externalIds, executor);

  await executor
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
        popularityScore: record.popularityScore,
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
        popularityScore: sql`excluded.popularity_score`,
        updatedAt: new Date(),
      },
    });

  let inserted = 0;
  let refreshed = 0;
  for (const id of externalIds) {
    if (existing.has(id)) refreshed += 1;
    else inserted += 1;
  }
  return { inserted, refreshed };
}

export async function insertSourceRecord(
  sourceId: string,
  record: ParsedSourceRecord,
  observedAt: Date,
  executor: typeof db | DbTransaction = db,
): Promise<void> {
  await executor.insert(sourceRecord).values({
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
    availability: 'available',
    sourceUpdatedAt: record.sourceUpdatedAt,
    lastSeenAt: observedAt,
    popularityScore: record.popularityScore,
  });
}

export async function findColdestEvictableRecord(
  sourceId: string,
  executor: typeof db | DbTransaction = db,
): Promise<{ id: string; externalId: string; popularityScore: number } | null> {
  const pendingIntent = executor
    .select({ id: sourceRecordSaveIntent.id })
    .from(sourceRecordSaveIntent)
    .where(
      and(eq(sourceRecordSaveIntent.sourceRecordId, sourceRecord.id), eq(sourceRecordSaveIntent.status, 'pending')),
    );

  const [row] = await executor
    .select({
      id: sourceRecord.id,
      externalId: sourceRecord.externalId,
      popularityScore: sourceRecord.popularityScore,
    })
    .from(sourceRecord)
    .where(
      and(
        eq(sourceRecord.sourceId, sourceId),
        isNull(sourceRecord.workId),
        notInArray(sourceRecord.materializationStatus, ['processing', 'ready']),
        notExists(pendingIntent),
      ),
    )
    .orderBy(asc(sourceRecord.popularityScore), asc(sourceRecord.lastSeenAt))
    .limit(1);
  return row ?? null;
}

export async function evictSourceRecordById(
  recordId: string,
  executor: typeof db | DbTransaction = db,
): Promise<boolean> {
  const result = await executor.delete(sourceRecord).where(eq(sourceRecord.id, recordId));
  return (result.rowCount ?? 0) > 0;
}

/** Batch upsert into staging; never touches `source_record`. */
export async function upsertCatalogEntriesBatch(
  sourceId: string,
  entries: CatalogEntryDraft[],
  observedAt: Date,
  executor: typeof db | DbTransaction = db,
): Promise<number> {
  if (entries.length === 0) return 0;

  await executor
    .insert(discoveryCatalogEntry)
    .values(
      entries.map((entry) => ({
        id: randomUUID(),
        sourceId,
        externalId: entry.externalId,
        title: entry.title,
        authors: entry.authors,
        languages: entry.languages,
        popularityScore: entry.popularityScore,
        hasEpub: entry.hasEpub,
        issuedAt: entry.issuedAt,
        coverUrl: entry.coverUrl,
        contentCandidates: entry.contentCandidates,
        sourceMeta: entry.sourceMeta,
        lastSeenAt: observedAt,
      })),
    )
    .onConflictDoUpdate({
      target: [discoveryCatalogEntry.sourceId, discoveryCatalogEntry.externalId],
      set: {
        title: sql`excluded.title`,
        authors: sql`excluded.authors`,
        languages: sql`excluded.languages`,
        popularityScore: sql`excluded.popularity_score`,
        hasEpub: sql`excluded.has_epub`,
        issuedAt: sql`excluded.issued_at`,
        coverUrl: sql`excluded.cover_url`,
        contentCandidates: sql`excluded.content_candidates`,
        sourceMeta: sql`excluded.source_meta`,
        lastSeenAt: sql`excluded.last_seen_at`,
        updatedAt: new Date(),
      },
    });

  return entries.length;
}

/**
 * Top-N staging rows for promote. Language filtering happens at CSV ingest;
 * this query only applies the EPUB gate and popularity order.
 */
export async function listTopCatalogEntriesForPromote(
  sourceId: string,
  limit: number,
  requireEpub: boolean,
): Promise<ParsedSourceRecord[]> {
  const rows = await db
    .select({
      externalId: discoveryCatalogEntry.externalId,
      title: discoveryCatalogEntry.title,
      authors: discoveryCatalogEntry.authors,
      languages: discoveryCatalogEntry.languages,
      coverUrl: discoveryCatalogEntry.coverUrl,
      contentCandidates: discoveryCatalogEntry.contentCandidates,
      sourceMeta: discoveryCatalogEntry.sourceMeta,
      popularityScore: discoveryCatalogEntry.popularityScore,
      issuedAt: discoveryCatalogEntry.issuedAt,
    })
    .from(discoveryCatalogEntry)
    .where(
      and(
        eq(discoveryCatalogEntry.sourceId, sourceId),
        ...(requireEpub ? [eq(discoveryCatalogEntry.hasEpub, true)] : []),
      ),
    )
    .orderBy(desc(discoveryCatalogEntry.popularityScore), asc(discoveryCatalogEntry.externalId))
    .limit(Math.max(0, limit));

  return rows.map((row) => ({
    externalId: row.externalId,
    title: row.title,
    authors: row.authors,
    languages: row.languages,
    description: null,
    rightsStatement: null,
    coverUrl: row.coverUrl,
    contentCandidates: row.contentCandidates,
    sourceMeta: row.sourceMeta,
    sourceUpdatedAt: row.issuedAt ? new Date(`${row.issuedAt}T00:00:00Z`) : null,
    popularityScore: row.popularityScore,
  }));
}

/** Evictable product-index rows whose external id is outside the promoted set. */
export async function listEvictableSourceRecordsNotIn(
  sourceId: string,
  keepExternalIds: ReadonlySet<string>,
  executor: typeof db | DbTransaction = db,
): Promise<{ id: string; externalId: string }[]> {
  const pendingIntent = executor
    .select({ id: sourceRecordSaveIntent.id })
    .from(sourceRecordSaveIntent)
    .where(
      and(eq(sourceRecordSaveIntent.sourceRecordId, sourceRecord.id), eq(sourceRecordSaveIntent.status, 'pending')),
    );

  const rows = await executor
    .select({
      id: sourceRecord.id,
      externalId: sourceRecord.externalId,
    })
    .from(sourceRecord)
    .where(
      and(
        eq(sourceRecord.sourceId, sourceId),
        isNull(sourceRecord.workId),
        notInArray(sourceRecord.materializationStatus, ['processing', 'ready']),
        notExists(pendingIntent),
      ),
    );

  if (keepExternalIds.size === 0) return rows;
  return rows.filter((row) => !keepExternalIds.has(row.externalId));
}

export async function createDiscoverySyncRun(input: {
  sourceId: string;
  claimToken: Date;
  now: Date;
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
    })
    .onConflictDoNothing({ target: [discoverySyncRun.sourceId, discoverySyncRun.claimToken] })
    .returning();
  if (row) return row;
  const [existing] = await executor
    .select()
    .from(discoverySyncRun)
    .where(and(eq(discoverySyncRun.sourceId, input.sourceId), eq(discoverySyncRun.claimToken, input.claimToken)))
    .limit(1);
  if (!existing) throw new Error('Failed to create the discovery sync run record');
  return existing;
}

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

export async function markDiscoverySyncRunStarted(input: {
  sourceId: string;
  claimToken: Date;
  startedAt: Date;
  executor: DbTransaction;
}): Promise<boolean> {
  const result = await input.executor
    .update(discoverySyncRun)
    .set({ stage: 'downloading', startedAt: input.startedAt })
    .where(
      and(
        eq(discoverySyncRun.sourceId, input.sourceId),
        eq(discoverySyncRun.claimToken, input.claimToken),
        eq(discoverySyncRun.stage, 'queued'),
      ),
    );
  return (result.rowCount ?? 0) > 0;
}

export async function advanceDiscoverySyncRunStage(input: {
  sourceId: string;
  claimToken: Date;
  runStartedAt: Date;
  stage: Extract<DiscoverySyncRunStage, 'processing'>;
  counters?: { inserted: number; refreshed: number; evicted: number; skippedFilter: number };
}): Promise<void> {
  await db.transaction(async (tx) => {
    await lockSourceRunOwnership(tx, input.sourceId, input.runStartedAt);
    await tx
      .update(discoverySyncRun)
      .set({
        stage: input.stage,
        ...(input.counters
          ? {
              inserted: input.counters.inserted,
              refreshed: input.counters.refreshed,
              evicted: input.counters.evicted,
              skippedFilter: input.counters.skippedFilter,
            }
          : {}),
      })
      .where(
        and(
          eq(discoverySyncRun.sourceId, input.sourceId),
          eq(discoverySyncRun.claimToken, input.claimToken),
          notInArray(discoverySyncRun.stage, [...TERMINAL_RUN_STAGES]),
        ),
      );
  });
}

export async function finishDiscoverySyncRun(input: {
  sourceId: string;
  claimToken: Date;
  runStartedAt: Date;
  stage: Extract<DiscoverySyncRunStage, 'succeeded' | 'not_modified' | 'skipped' | 'failed'>;
  finishedAt: Date;
  counters?: { inserted: number; refreshed: number; evicted: number; skippedFilter: number };
  errorSummary?: string;
  snapshotLastModified?: string | null;
  executor: DbTransaction;
}): Promise<void> {
  await lockSourceRunOwnership(input.executor, input.sourceId, input.runStartedAt);
  await input.executor
    .update(discoverySyncRun)
    .set({
      stage: input.stage,
      finishedAt: input.finishedAt,
      ...(input.counters
        ? {
            inserted: input.counters.inserted,
            refreshed: input.counters.refreshed,
            evicted: input.counters.evicted,
            skippedFilter: input.counters.skippedFilter,
          }
        : {}),
      errorSummary: input.errorSummary ? input.errorSummary.slice(0, 500) : null,
      ...(input.snapshotLastModified !== undefined ? { snapshotLastModified: input.snapshotLastModified } : {}),
    })
    .where(
      and(
        eq(discoverySyncRun.sourceId, input.sourceId),
        eq(discoverySyncRun.claimToken, input.claimToken),
        notInArray(discoverySyncRun.stage, [...TERMINAL_RUN_STAGES]),
      ),
    );
}

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

export async function finishDiscoverySyncRunSkipped(input: {
  sourceId: string;
  claimToken: Date;
  finishedAt: Date;
  executor: DbTransaction;
}): Promise<void> {
  const [row] = await input.executor
    .select({ id: discoverySyncRun.id, stage: discoverySyncRun.stage })
    .from(discoverySyncRun)
    .where(and(eq(discoverySyncRun.sourceId, input.sourceId), eq(discoverySyncRun.claimToken, input.claimToken)))
    .for('update')
    .limit(1);
  if (!row || isDiscoverySyncRunTerminalStage(row.stage)) return;
  await input.executor
    .update(discoverySyncRun)
    .set({ stage: 'skipped', finishedAt: input.finishedAt, errorSummary: null })
    .where(eq(discoverySyncRun.id, row.id));
}

export async function recoverStaleDiscoverySyncRun(input: {
  sourceId: string;
  claimToken: Date;
  errorSummary: string;
  finishedAt: Date;
  executor: DbTransaction;
}): Promise<void> {
  const [row] = await input.executor
    .select({ id: discoverySyncRun.id, stage: discoverySyncRun.stage })
    .from(discoverySyncRun)
    .where(and(eq(discoverySyncRun.sourceId, input.sourceId), eq(discoverySyncRun.claimToken, input.claimToken)))
    .for('update')
    .limit(1);
  if (!row || isDiscoverySyncRunTerminalStage(row.stage)) return;
  await input.executor
    .update(discoverySyncRun)
    .set({
      stage: 'failed',
      finishedAt: input.finishedAt,
      errorSummary: input.errorSummary.slice(0, 500),
    })
    .where(eq(discoverySyncRun.id, row.id));
}

/** Drop sync-run rows beyond the bounded history limit (oldest first). */
export async function trimDiscoverySyncRunHistory(sourceId: string): Promise<void> {
  const keep = DISCOVERY_SYNC_RUN_HISTORY_LIMIT;
  const stale = await db
    .select({ id: discoverySyncRun.id })
    .from(discoverySyncRun)
    .where(eq(discoverySyncRun.sourceId, sourceId))
    .orderBy(desc(discoverySyncRun.queuedAt), desc(discoverySyncRun.claimToken))
    .offset(keep);
  if (stale.length === 0) return;
  await db.delete(discoverySyncRun).where(
    inArray(
      discoverySyncRun.id,
      stale.map((row) => row.id),
    ),
  );
}

export {
  DISCOVERY_INDEX_BYTES_PER_ROW_HINT,
  estimateIndexBytesFromRowCount,
} from '@/server/domains/discovery/sync/index-size';

/** Row-count based estimate; `sourceId` retained for call-site compatibility. */
export async function estimateIndexBytesForSource(_sourceId: string, recordCount: number): Promise<number> {
  return estimateIndexBytesFromRowCount(recordCount);
}

/**
 * Atomically promote Top-N into `source_record` for one source.
 * On any failure (including soft budget overrun) the whole promote rolls back —
 * Discover never sees a partial sync write.
 */
export async function promoteSourceRecordsAtomically(input: {
  sourceId: string;
  runStartedAt: Date;
  records: ParsedSourceRecord[];
  observedAt: Date;
  evictionPolicy: DiscoverySourceRow['evictionPolicy'];
  budgetBytesHint: number;
}): Promise<{ inserted: number; refreshed: number; evicted: number }> {
  const keepExternalIds = new Set(input.records.map((record) => record.externalId));

  return db.transaction(async (tx) => {
    await lockSourceRunOwnership(tx, input.sourceId, input.runStartedAt);

    let inserted = 0;
    let refreshed = 0;
    for (let i = 0; i < input.records.length; i += 500) {
      const batch = input.records.slice(i, i + 500);
      const result = await upsertSourceRecordsBatch(input.sourceId, batch, input.observedAt, tx);
      inserted += result.inserted;
      refreshed += result.refreshed;
    }

    let evicted = 0;
    if (input.evictionPolicy === 'hot_swap') {
      const evictable = await listEvictableSourceRecordsNotIn(input.sourceId, keepExternalIds, tx);
      for (const row of evictable) {
        const removed = await evictSourceRecordById(row.id, tx);
        if (removed) evicted += 1;
      }
    }

    const rowCount = await countSourceRecords(input.sourceId, tx);
    const estimatedBytes = estimateIndexBytesFromRowCount(rowCount);
    if (estimatedBytes > input.budgetBytesHint) {
      throw new Error(
        `index size estimate (${estimatedBytes} bytes for ${rowCount} rows) exceeds budget hint (${input.budgetBytesHint} bytes)`,
      );
    }

    return { inserted, refreshed, evicted };
  });
}
