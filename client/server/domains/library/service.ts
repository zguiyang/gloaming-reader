import { randomUUID } from 'node:crypto';

import { and, count, desc, eq, sql } from 'drizzle-orm';

import {
  readingState as readingStateTable,
  readingWork as readingWorkTable,
  userLibraryItem as userLibraryItemTable,
  userWorkTag as userWorkTagTable,
} from '@/server/db';
import { sourceRecord as sourceRecordTable, sourceRecordSaveIntent as saveIntentTable } from '@/server/db/schema';
import {
  LIBRARY_ITEMS_LIMIT,
  type LibraryBrowseData,
  type LibraryBrowseQuery,
  type LibraryData,
  type LibraryItem,
} from '@gloaming/shared/library';
import { workAvailability } from '@gloaming/shared/works';

import { loadUserTagsByWorkIds } from '@/server/domains/library/tags/service';
import { toReadingState } from '@/server/domains/reading';
import { publicCatalogWorkSql, workReadAccessSql, workReadActorFromIdentity } from '@/server/domains/works/access';
import { loadPartSortOrdersByWorkIds } from '@/server/domains/works/read-model';
import { db } from '@/server/infra/db';
import { NotFoundError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';

type WorkRow = typeof readingWorkTable.$inferSelect;

/** Search the complete owner-scoped shelf before limiting results. */
export async function browseLibrary(userId: string, query: LibraryBrowseQuery): Promise<LibraryBrowseData> {
  const size = 24;
  const source =
    query.source === 'personal'
      ? sql`AND m.kind = 'personal'`
      : query.source === 'saved'
        ? sql`AND m.kind = 'saved'`
        : sql``;
  const tag = query.tag
    ? sql`AND EXISTS (SELECT 1 FROM user_work_tag t WHERE t.user_id = ${userId} AND t.work_id = w.id AND t.tag_id = ${query.tag})`
    : sql``;
  const term = query.q?.trim();
  const pattern = term ? `%${term.replace(/[\\%_]/g, '\\$&')}%` : '';
  const search = term ? sql`AND (w.title ILIKE ${pattern} OR w.author ILIKE ${pattern})` : sql``;
  const readable = sql`(w.processing_status IN ('parsed', 'metadata', 'ready') AND EXISTS (SELECT 1 FROM reading_part p WHERE p.work_id = w.id))`;
  const status =
    query.status === 'reading'
      ? sql`AND ${readable} AND s.status = 'in_progress'`
      : query.status === 'completed'
        ? sql`AND ${readable} AND s.status = 'completed'`
        : query.status === 'unread'
          ? sql`AND ${readable} AND s.status IS NULL`
          : sql``;
  const order =
    query.sort === 'title'
      ? sql`lower(w.title) ASC, w.id DESC`
      : query.sort === 'recent'
        ? sql`s.last_read_at DESC NULLS LAST, m.added_at DESC, w.id DESC`
        : sql`m.added_at DESC, w.id DESC`;
  const result = await db.execute<{ id: string }>(sql`
    WITH memberships AS (
      SELECT id AS work_id, created_at AS added_at, 'personal' AS kind FROM reading_work WHERE owner_user_id = ${userId}
      UNION ALL
      SELECT work_id, created_at AS added_at, 'saved' AS kind FROM user_library_item WHERE user_id = ${userId}
    )
    SELECT w.id FROM memberships m JOIN reading_work w ON w.id = m.work_id
    LEFT JOIN reading_state s ON s.work_id = w.id AND s.user_id = ${userId}
    WHERE true ${source} ${tag} ${search} ${status}
    ORDER BY ${order} LIMIT ${size + 1} OFFSET ${(query.page - 1) * size}
  `);
  const rows = result.rows;
  return {
    items: await Promise.all(rows.slice(0, size).map((row) => getLibraryItem(userId, row.id))),
    hasMore: rows.length > size,
  };
}

function toIso(value: Date): string {
  return value.toISOString();
}

function toWorkSummary(row: WorkRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    coverAssetId: row.coverAssetId,
    publishedAt: row.publishedAt ? toIso(row.publishedAt) : null,
  };
}

/** Library membership comes only from ownership or an explicit catalog save. */
export async function getLibrary(userId: string): Promise<LibraryData> {
  const [[currentRow], ownedRows, savedRows, [ownedCount], [savedCount]] = await Promise.all([
    db
      .select({ state: readingStateTable, work: readingWorkTable })
      .from(readingStateTable)
      .innerJoin(readingWorkTable, eq(readingStateTable.workId, readingWorkTable.id))
      .where(
        and(
          eq(readingStateTable.userId, userId),
          eq(readingStateTable.status, 'in_progress'),
          workReadAccessSql(workReadActorFromIdentity({ id: userId })),
        ),
      )
      .orderBy(desc(readingStateTable.lastReadAt), desc(readingStateTable.id))
      .limit(1),
    db
      .select({
        work: readingWorkTable,
        state: readingStateTable,
        sortAt: readingWorkTable.createdAt,
        canRemoveFromLibrary: sql<boolean>`false`,
      })
      .from(readingWorkTable)
      .leftJoin(
        readingStateTable,
        and(eq(readingStateTable.workId, readingWorkTable.id), eq(readingStateTable.userId, userId)),
      )
      .where(eq(readingWorkTable.ownerUserId, userId))
      .orderBy(desc(readingWorkTable.createdAt), desc(readingWorkTable.id))
      .limit(LIBRARY_ITEMS_LIMIT),
    db
      .select({
        work: readingWorkTable,
        state: readingStateTable,
        sortAt: userLibraryItemTable.createdAt,
        canRemoveFromLibrary: sql<boolean>`true`,
      })
      .from(userLibraryItemTable)
      .innerJoin(readingWorkTable, eq(userLibraryItemTable.workId, readingWorkTable.id))
      .leftJoin(
        readingStateTable,
        and(eq(readingStateTable.workId, readingWorkTable.id), eq(readingStateTable.userId, userId)),
      )
      // Membership, not publication, owns saved Library visibility: a Source work
      // saved before publication is readable by its member and must appear here.
      .where(eq(userLibraryItemTable.userId, userId))
      .orderBy(desc(userLibraryItemTable.createdAt), desc(readingWorkTable.id))
      .limit(LIBRARY_ITEMS_LIMIT),
    // Aggregate counts instead of row fetches keep the truncation check bounded.
    db.select({ value: count() }).from(readingWorkTable).where(eq(readingWorkTable.ownerUserId, userId)),
    db.select({ value: count() }).from(userLibraryItemTable).where(eq(userLibraryItemTable.userId, userId)),
  ]);

  const orderedRows = [...ownedRows, ...savedRows]
    .sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime() || b.work.id.localeCompare(a.work.id))
    .slice(0, LIBRARY_ITEMS_LIMIT);
  // Saved membership requires an unowned Catalog Work (`publicCatalogWorkSql`), so Personal
  // ownership and saved membership are disjoint and the union size is the plain sum.
  const totalMemberCount = Number(ownedCount?.value ?? 0) + Number(savedCount?.value ?? 0);
  const isTruncated = totalMemberCount > orderedRows.length;
  const workIds = [...(currentRow ? [currentRow.work.id] : []), ...orderedRows.map((row) => row.work.id)];
  const [partsByWork, userTagsByWork] = await Promise.all([
    loadPartSortOrdersByWorkIds(workIds),
    loadUserTagsByWorkIds(userId, workIds),
  ]);
  const toItem = (row: {
    work: WorkRow;
    state: typeof readingStateTable.$inferSelect | null;
    canRemoveFromLibrary: boolean;
  }): LibraryItem => ({
    work: toWorkSummary(row.work),
    state: row.state ? toReadingState(row.state, partsByWork.get(row.work.id) ?? []) : null,
    availability: workAvailability(row.work.processingStatus, (partsByWork.get(row.work.id) ?? []).length),
    canRemoveFromLibrary: row.canRemoveFromLibrary,
    libraryItemKind: row.canRemoveFromLibrary ? 'saved_catalog' : 'personal',
    personalMetadata: row.canRemoveFromLibrary
      ? null
      : {
          author: row.work.author,
          language: row.work.language,
          estimatedMinutes: row.work.estimatedMinutes,
          suggestedVocabSize: row.work.suggestedVocabSize,
          difficultyScore: row.work.difficultyScore,
        },
    userTags: userTagsByWork.get(row.work.id) ?? [],
  });

  return {
    current: currentRow
      ? {
          work: toWorkSummary(currentRow.work),
          state: toReadingState(currentRow.state, partsByWork.get(currentRow.work.id) ?? []),
        }
      : null,
    items: orderedRows.map(toItem),
    isTruncated,
  };
}

/** Owner-scoped single membership, independent of the Library grid limit. */
export async function getLibraryItem(userId: string, workId: string): Promise<LibraryItem> {
  const [owned] = await db
    .select({ work: readingWorkTable, state: readingStateTable })
    .from(readingWorkTable)
    .leftJoin(
      readingStateTable,
      and(eq(readingStateTable.workId, readingWorkTable.id), eq(readingStateTable.userId, userId)),
    )
    .where(and(eq(readingWorkTable.id, workId), eq(readingWorkTable.ownerUserId, userId)))
    .limit(1);
  const [saved] = owned
    ? []
    : await db
        .select({ work: readingWorkTable, state: readingStateTable })
        .from(userLibraryItemTable)
        .innerJoin(readingWorkTable, eq(userLibraryItemTable.workId, readingWorkTable.id))
        .leftJoin(
          readingStateTable,
          and(eq(readingStateTable.workId, readingWorkTable.id), eq(readingStateTable.userId, userId)),
        )
        .where(
          and(
            eq(userLibraryItemTable.userId, userId),
            eq(readingWorkTable.id, workId),
            workReadAccessSql(workReadActorFromIdentity({ id: userId })),
          ),
        )
        .limit(1);
  const row = owned ?? saved;
  if (!row) throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
  const [parts, tags] = await Promise.all([
    loadPartSortOrdersByWorkIds([workId]),
    loadUserTagsByWorkIds(userId, [workId]),
  ]);
  const orders = parts.get(workId) ?? [];
  return {
    work: toWorkSummary(row.work),
    state: row.state ? toReadingState(row.state, orders) : null,
    availability: workAvailability(row.work.processingStatus, orders.length),
    canRemoveFromLibrary: !owned,
    libraryItemKind: owned ? 'personal' : 'saved_catalog',
    personalMetadata: owned
      ? {
          author: row.work.author,
          language: row.work.language,
          estimatedMinutes: row.work.estimatedMinutes,
          suggestedVocabSize: row.work.suggestedVocabSize,
          difficultyScore: row.work.difficultyScore,
        }
      : null,
    userTags: tags.get(workId) ?? [],
  };
}

/** Explicitly save a published Catalog work; repeated saves are successful no-ops. */
export async function addToLibrary(userId: string, workId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [work] = await tx
      .select({ id: readingWorkTable.id })
      .from(readingWorkTable)
      .where(and(eq(readingWorkTable.id, workId), publicCatalogWorkSql()))
      .for('share')
      .limit(1);
    if (!work) {
      throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
    }

    await tx
      .insert(userLibraryItemTable)
      .values({ id: randomUUID(), userId, workId })
      .onConflictDoNothing({ target: [userLibraryItemTable.userId, userLibraryItemTable.workId] });
  });
}

/**
 * Remove Catalog membership and its private organization labels, preserving reading facts.
 *
 * Removal is also an un-save for Discover-sourced Works: the same transaction
 * drops this user's Save Intent for the Work's linked SourceRecord, so
 * `GET /api/library/source-records/:id` reports `none` and Discover offers
 * "Add to Library" again. Personal Works have no SourceRecord link, so they
 * fall through untouched; other users' intents, reading progress, and the Work
 * itself are never deleted here.
 */
export async function removeFromLibrary(userId: string, workId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const removed = await tx
      .delete(userLibraryItemTable)
      .where(and(eq(userLibraryItemTable.userId, userId), eq(userLibraryItemTable.workId, workId)))
      .returning({ workId: userLibraryItemTable.workId });
    if (removed.length === 0) return;
    await tx
      .delete(userWorkTagTable)
      .where(and(eq(userWorkTagTable.userId, userId), eq(userWorkTagTable.workId, workId)));

    // At most one SourceRecord links to a Work (`source_record_work_uidx`), and
    // Personal Works link none, so an unlinked Work leaves no intent behind.
    const [record] = await tx
      .select({ id: sourceRecordTable.id })
      .from(sourceRecordTable)
      .where(eq(sourceRecordTable.workId, workId))
      .limit(1);
    if (!record) return;
    await tx
      .delete(saveIntentTable)
      .where(and(eq(saveIntentTable.userId, userId), eq(saveIntentTable.sourceRecordId, record.id)));
  });
}
