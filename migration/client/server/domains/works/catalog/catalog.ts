import { and, asc, count, desc, eq, ilike, notExists, type SQL } from 'drizzle-orm';

import { readingWork as readingWorkTable } from '@/server/db';
import { sourceRecord as sourceRecordTable } from '@/server/db/schema';
import { buildPaginationMeta } from '@gloaming/shared/pagination';
import { type CatalogListData, type CatalogListQuery, type Work } from '@gloaming/shared/works';

import type { WorkReadActor } from '@/server/domains/works/access';
import { publicCatalogWorkSql, workReadAccessSql } from '@/server/domains/works/access';
import { toWork } from '@/server/domains/works/read-model/projection';
import { loadPartCountsByWorkIds } from '@/server/domains/works/read-model/relations';
import { ensureWorkReadingStatsIfMissing } from '@/server/domains/works/read-model/stats';
import { db } from '@/server/infra/db';
import { NotFoundError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';

function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function catalogPublishedWorkFilter(id?: string): SQL {
  return and(...(id ? [eq(readingWorkTable.id, id)] : []), publicCatalogWorkSql())!;
}

function publishedListWhere(query: Pick<CatalogListQuery, 'q' | 'sourceLink'>): SQL {
  const parts: SQL[] = [catalogPublishedWorkFilter()];
  if (query.q) {
    parts.push(ilike(readingWorkTable.title, `%${escapeIlikePattern(query.q)}%`));
  }
  // Compatibility read for Discover: a Work linked to a SourceRecord is already
  // represented by that SourceRecord, so it must not render twice.
  if (query.sourceLink === 'unlinked') {
    parts.push(
      notExists(
        db
          .select({ id: sourceRecordTable.id })
          .from(sourceRecordTable)
          .where(eq(sourceRecordTable.workId, readingWorkTable.id)),
      ),
    );
  }
  return and(...parts)!;
}

function publishedListOrderBy(query: Pick<CatalogListQuery, 'sortBy' | 'sortOrder'>) {
  const column =
    query.sortBy === 'createdAt'
      ? readingWorkTable.createdAt
      : query.sortBy === 'updatedAt'
        ? readingWorkTable.updatedAt
        : readingWorkTable.publishedAt;
  const primary = query.sortOrder === 'asc' ? asc(column) : desc(column);
  return [primary, desc(readingWorkTable.id)] as const;
}

export async function listCatalogWorks(query: CatalogListQuery): Promise<CatalogListData> {
  const where = publishedListWhere(query);
  const orderBy = publishedListOrderBy(query);
  const offset = (query.page - 1) * query.pageSize;

  const [countRow, rows] = await Promise.all([
    db
      .select({ value: count() })
      .from(readingWorkTable)
      .where(where)
      .then((result) => result[0]),
    db
      .select()
      .from(readingWorkTable)
      .where(where)
      .orderBy(...orderBy)
      .limit(query.pageSize)
      .offset(offset),
  ]);
  const total = Number(countRow?.value ?? 0);

  const partCountsByWork = await loadPartCountsByWorkIds(rows.map((row) => row.id));
  return {
    items: rows.map((row) => ({
      ...toWork(row),
      partCount: partCountsByWork.get(row.id) ?? 0,
    })),
    pagination: buildPaginationMeta({
      page: query.page,
      pageSize: query.pageSize,
      total,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    }),
  };
}

export async function getCatalogWork(actor: WorkReadActor, id: string): Promise<Work> {
  const access = workReadAccessSql(actor);
  const where = access ? and(eq(readingWorkTable.id, id), access) : eq(readingWorkTable.id, id);
  const [row] = await db.select().from(readingWorkTable).where(where).limit(1);

  if (!row) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
  }
  const hydrated = await ensureWorkReadingStatsIfMissing(row);
  const [source] = await db
    .select({ meta: sourceRecordTable.sourceMeta, description: sourceRecordTable.description })
    .from(sourceRecordTable)
    .where(eq(sourceRecordTable.workId, id))
    .limit(1);
  return {
    ...toWork(hydrated),
    ...(source
      ? {
          sourceSummary:
            source.meta.summary ?? (hydrated.description !== source.description ? hydrated.description || null : null),
          sourceNotes: source.meta.notes ?? (source.description ? [source.description] : []),
        }
      : {}),
  };
}
