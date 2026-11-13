import { randomUUID } from 'node:crypto';

import { and, eq, isNull, notExists, sql } from 'drizzle-orm';

import {
  discoverySource as discoverySourceTable,
  sourceRecord as sourceRecordTable,
  sourceRecordSaveIntent as saveIntentTable,
  type SourceRecordContentCandidate,
  type SourceRecordSourceMeta,
} from '@/server/db/schema';
import type { SourceRecordDetail } from '@/shared/discovery';

import {
  PROJECT_GUTENBERG_SOURCE_KEY,
  PROJECT_GUTENBERG_SOURCE_TYPE,
} from '@/server/domains/discovery/gutenberg/constants';
import { getGutenbergOpdsRecord } from '@/server/domains/discovery/gutenberg/opds-adapter';
import { db } from '@/server/infra/db';
import { HTTP_STATUS } from '@/server/shared/constants';
import { AppError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';

export type DiscoverySourceRow = typeof discoverySourceTable.$inferSelect;
export type SourceRecordRow = typeof sourceRecordTable.$inferSelect;

/** Creates the stable source row if missing, then returns it. */
export async function ensureDiscoverySource(sourceKey: string, sourceType: string): Promise<DiscoverySourceRow> {
  await db
    .insert(discoverySourceTable)
    .values({ id: randomUUID(), sourceKey, sourceType })
    .onConflictDoNothing({ target: discoverySourceTable.sourceKey });

  const [row] = await db
    .select()
    .from(discoverySourceTable)
    .where(eq(discoverySourceTable.sourceKey, sourceKey))
    .limit(1);
  if (!row) {
    throw new Error(`Failed to initialize discovery source "${sourceKey}"`);
  }

  if (row.sourceType !== sourceType) {
    const [updated] = await db
      .update(discoverySourceTable)
      .set({ sourceType })
      .where(eq(discoverySourceTable.id, row.id))
      .returning();
    return updated ?? { ...row, sourceType };
  }

  return row;
}

export async function findSourceRecordByExternalId(
  sourceKey: string,
  externalId: string,
): Promise<(SourceRecordRow & { sourceKey: string; sourceType: string; enabled: boolean }) | null> {
  const [row] = await db
    .select({
      record: sourceRecordTable,
      sourceKey: discoverySourceTable.sourceKey,
      sourceType: discoverySourceTable.sourceType,
      enabled: discoverySourceTable.enabled,
    })
    .from(sourceRecordTable)
    .innerJoin(discoverySourceTable, eq(sourceRecordTable.sourceId, discoverySourceTable.id))
    .where(and(eq(discoverySourceTable.sourceKey, sourceKey), eq(sourceRecordTable.externalId, externalId)))
    .limit(1);
  if (!row) return null;
  return { ...row.record, sourceKey: row.sourceKey, sourceType: row.sourceType, enabled: row.enabled };
}

/**
 * Upsert a minimal SourceRecord from an on-demand OPDS detail. Existing
 * materialized work links are preserved; content candidates refresh when the
 * record is not yet linked to a Work.
 */
export async function upsertSourceRecordFromDetail(detail: SourceRecordDetail): Promise<SourceRecordRow> {
  const source = await ensureDiscoverySource(detail.sourceKey, detail.sourceType);
  const existing = await findSourceRecordByExternalId(detail.sourceKey, detail.externalId);
  const now = new Date();

  if (existing) {
    return applySourceRecordDetail(existing, detail, now);
  }

  const [inserted] = await db
    .insert(sourceRecordTable)
    .values({
      id: randomUUID(),
      sourceId: source.id,
      externalId: detail.externalId,
      title: detail.title,
      authors: detail.authors,
      languages: detail.languages,
      description: detail.description,
      rightsStatement: detail.rightsStatement,
      coverUrl: detail.coverUrl,
      contentCandidates: detail.contentCandidates as SourceRecordContentCandidate[],
      sourceMeta: detail.sourceMeta as SourceRecordSourceMeta,
      availability: 'available',
      lastSeenAt: now,
      sourceUpdatedAt: detail.sourceUpdatedAt ? new Date(detail.sourceUpdatedAt) : null,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted) {
    return inserted;
  }

  // A concurrent writer created the same (source, externalId) row between our
  // read and this insert. Without `DO NOTHING` the unique violation escapes to
  // the route as an unhandled 500 instead of a converging update.
  const winner = await findSourceRecordByExternalId(detail.sourceKey, detail.externalId);
  if (!winner) {
    throw new Error(`Failed to insert source record for ${detail.sourceKey}/${detail.externalId}`);
  }
  return applySourceRecordDetail(winner, detail, now);
}

type ExistingSourceRecord = NonNullable<Awaited<ReturnType<typeof findSourceRecordByExternalId>>>;

async function applySourceRecordDetail(
  existing: ExistingSourceRecord,
  detail: SourceRecordDetail,
  now: Date,
): Promise<SourceRecordRow> {
  const shouldRefreshCandidates = existing.workId === null;
  const [updated] = await db
    .update(sourceRecordTable)
    .set({
      title: detail.title,
      authors: detail.authors,
      languages: detail.languages,
      description: detail.description,
      rightsStatement: detail.rightsStatement,
      coverUrl: detail.coverUrl,
      ...(shouldRefreshCandidates
        ? {
            contentCandidates: detail.contentCandidates as SourceRecordContentCandidate[],
            sourceMeta: detail.sourceMeta as SourceRecordSourceMeta,
          }
        : {}),
      availability: 'available',
      lastSeenAt: now,
      sourceUpdatedAt: detail.sourceUpdatedAt ? new Date(detail.sourceUpdatedAt) : existing.sourceUpdatedAt,
    })
    .where(eq(sourceRecordTable.id, existing.id))
    .returning();
  return updated ?? existing;
}

/** Fetch OPDS detail and upsert the local SourceRecord used by Save Intent. */
export async function ensureSourceRecordForDiscoverSave(input: {
  sourceKey: string;
  externalId: string;
}): Promise<SourceRecordRow> {
  if (input.sourceKey !== PROJECT_GUTENBERG_SOURCE_KEY) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_INVALID_INPUT);
  }
  const source = await ensureDiscoverySource(PROJECT_GUTENBERG_SOURCE_KEY, PROJECT_GUTENBERG_SOURCE_TYPE);
  if (!source.enabled) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND.SOURCE_RECORD);
  }
  const detail = await getGutenbergOpdsRecord(input.externalId);
  return upsertSourceRecordFromDetail(detail);
}

/**
 * Delete SourceRecord rows that are not linked to a ReadingWork and have no
 * save intent. Safe cleanup for historical full-sync bibliography residue.
 */
export async function deleteOrphanSourceRecords(): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM source_record sr
    WHERE sr.work_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM source_record_save_intent si
        WHERE si.source_record_id = sr.id
      )
  `);
  return Number(result.rowCount ?? 0);
}

/** Count orphan bibliography rows (dry-run helper). */
export async function countOrphanSourceRecords(): Promise<number> {
  const rows = await db
    .select({ id: sourceRecordTable.id })
    .from(sourceRecordTable)
    .where(
      and(
        isNull(sourceRecordTable.workId),
        notExists(
          db
            .select({ one: sql`1` })
            .from(saveIntentTable)
            .where(eq(saveIntentTable.sourceRecordId, sourceRecordTable.id)),
        ),
      ),
    );
  return rows.length;
}
