import { randomUUID } from 'node:crypto';

import { and, desc, eq } from 'drizzle-orm';

import {
  readingState as readingStateTable,
  readingWork as readingWorkTable,
  userLibraryItem as userLibraryItemTable,
} from '@gloaming/db';
import { LIBRARY_ITEMS_LIMIT, type LibraryData, type LibraryItem } from '@gloaming/shared/library';
import type { TaxonomyReference } from '@gloaming/shared/taxonomy';

import { toReadingState } from '@/domains/reading';
import { publicCatalogWorkSql, workReadAccessSql, workReadActorFromIdentity } from '@/domains/works/access';
import { loadPartSortOrdersByWorkIds, loadTagsByWorkIds } from '@/domains/works/read-model';
import { db } from '@/infra/db';
import { NotFoundError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

type WorkRow = typeof readingWorkTable.$inferSelect;

function toIso(value: Date): string {
  return value.toISOString();
}

function toWorkSummary(row: WorkRow, tags: TaxonomyReference[]) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    tags,
    coverAssetId: row.coverAssetId,
    publishedAt: row.publishedAt ? toIso(row.publishedAt) : null,
  };
}

/** Library membership comes only from ownership or an explicit catalog save. */
export async function getLibrary(userId: string): Promise<LibraryData> {
  const [currentRow] = await db
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
    .limit(1);

  const [ownedRows, savedRows] = await Promise.all([
    db
      .select({ work: readingWorkTable, state: readingStateTable, sortAt: readingWorkTable.createdAt })
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
      })
      .from(userLibraryItemTable)
      .innerJoin(readingWorkTable, eq(userLibraryItemTable.workId, readingWorkTable.id))
      .leftJoin(
        readingStateTable,
        and(eq(readingStateTable.workId, readingWorkTable.id), eq(readingStateTable.userId, userId)),
      )
      .where(and(eq(userLibraryItemTable.userId, userId), publicCatalogWorkSql()))
      .orderBy(desc(userLibraryItemTable.createdAt), desc(readingWorkTable.id))
      .limit(LIBRARY_ITEMS_LIMIT),
  ]);

  const orderedRows = [...ownedRows, ...savedRows]
    .sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime() || b.work.id.localeCompare(a.work.id))
    .slice(0, LIBRARY_ITEMS_LIMIT);
  const workIds = [...(currentRow ? [currentRow.work.id] : []), ...orderedRows.map((row) => row.work.id)];
  const [tagsByWork, partsByWork] = await Promise.all([
    loadTagsByWorkIds(workIds),
    loadPartSortOrdersByWorkIds(workIds),
  ]);
  const toItem = (row: { work: WorkRow; state: typeof readingStateTable.$inferSelect | null }): LibraryItem => ({
    work: toWorkSummary(row.work, tagsByWork.get(row.work.id) ?? []),
    state: row.state ? toReadingState(row.state, partsByWork.get(row.work.id) ?? []) : null,
  });

  return {
    current: currentRow
      ? {
          work: toWorkSummary(currentRow.work, tagsByWork.get(currentRow.work.id) ?? []),
          state: toReadingState(currentRow.state, partsByWork.get(currentRow.work.id) ?? []),
        }
      : null,
    items: orderedRows.map(toItem),
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

/** Remove only the explicit Catalog membership row; absence is already the desired state. */
export async function removeFromLibrary(userId: string, workId: string): Promise<void> {
  await db
    .delete(userLibraryItemTable)
    .where(and(eq(userLibraryItemTable.userId, userId), eq(userLibraryItemTable.workId, workId)));
}
