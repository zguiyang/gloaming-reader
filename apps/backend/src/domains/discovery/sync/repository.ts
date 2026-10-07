import { randomUUID } from 'node:crypto';

import { and, count, eq, isNull, lt, notInArray, or, sql } from 'drizzle-orm';

import { discoverySource, sourceRecord } from '@gloaming/db/schema';

import type { ParsedSourceRecord } from '@/domains/discovery/gutenberg/rdf-record';
import { db } from '@/infra/db';

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
 * Returns false when a run is already queued/syncing or when the source is disabled,
 * so a repeated trigger cannot enqueue a duplicate concurrent snapshot sync and a
 * disabled source cannot be newly claimed.
 */
export async function claimSourceQueued(sourceId: string): Promise<boolean> {
  const result = await db
    .update(discoverySource)
    .set({ syncStatus: 'queued', syncStartedAt: null, lastErrorSummary: null })
    .where(
      and(
        eq(discoverySource.id, sourceId),
        eq(discoverySource.enabled, true),
        notInArray(discoverySource.syncStatus, ['queued', 'syncing']),
      ),
    );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Clears a queued claim without running upstream, e.g. when the source was disabled
 * between enqueue and execution. Leaves the source `idle`; it is not an upstream
 * failure, so no error summary is recorded. Only releases a still-queued row, and
 * preserves the previous `syncFinishedAt` so Admin "Last sync" stays meaningful.
 */
export async function releaseSourceQueued(sourceId: string): Promise<void> {
  await db
    .update(discoverySource)
    .set({ syncStatus: 'idle', syncStartedAt: null, lastErrorSummary: null })
    .where(and(eq(discoverySource.id, sourceId), eq(discoverySource.syncStatus, 'queued')));
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
 * `enabled = true` and `syncStatus = 'queued'` together, so a source disabled
 * after queueing — or a job that no longer owns the queued claim — cannot begin
 * fetching. A failed transition reports whether the source is disabled or simply
 * no longer queued, without writing an error summary.
 */
export async function startSourceSyncing(sourceId: string, startedAt: Date): Promise<StartSourceSyncOutcome> {
  const result = await db
    .update(discoverySource)
    .set({ syncStatus: 'syncing', syncStartedAt: startedAt, lastErrorSummary: null })
    .where(
      and(
        eq(discoverySource.id, sourceId),
        eq(discoverySource.enabled, true),
        eq(discoverySource.syncStatus, 'queued'),
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
export async function markSourceSucceeded(input: {
  sourceId: string;
  lastModified: string | null;
  finishedAt: Date;
}): Promise<void> {
  await db
    .update(discoverySource)
    .set({
      syncStatus: 'succeeded',
      syncFinishedAt: input.finishedAt,
      lastSuccessAt: input.finishedAt,
      lastErrorSummary: null,
      ...(input.lastModified ? { snapshotLastModified: input.lastModified } : {}),
    })
    .where(eq(discoverySource.id, input.sourceId));
}

export async function markSourceFailed(input: {
  sourceId: string;
  errorSummary: string;
  finishedAt: Date;
}): Promise<void> {
  await db
    .update(discoverySource)
    .set({
      syncStatus: 'failed',
      syncFinishedAt: input.finishedAt,
      lastErrorSummary: input.errorSummary.slice(0, 500),
    })
    .where(eq(discoverySource.id, input.sourceId));
}

/**
 * Idempotent multi-row upsert keyed by (source_id, external_id).
 * Only source-owned fields are updated; identity and createdAt are preserved.
 */
export async function upsertSourceRecords(
  sourceId: string,
  records: ParsedSourceRecord[],
  observedAt: Date,
): Promise<void> {
  if (records.length === 0) {
    return;
  }

  await db
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
    });
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
