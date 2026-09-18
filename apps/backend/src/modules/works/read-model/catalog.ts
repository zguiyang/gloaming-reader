import { and, asc, count, desc, eq, exists, ilike, inArray, or, type SQL, sql } from 'drizzle-orm';

import {
  category as categoryTable,
  readingWork as readingWorkTable,
  readingWorkCategory as readingWorkCategoryTable,
  readingWorkTag as readingWorkTagTable,
  tag as tagTable,
} from '@gloaming/db';
import { buildPaginationMeta } from '@gloaming/shared/pagination';
import type { CatalogTaxonomyListData } from '@gloaming/shared/taxonomy';
import { type CatalogListData, type CatalogListQuery, type Work } from '@gloaming/shared/works';

import { db } from '@/db';
import { NotFoundError } from '@/lib/errors/app-error';
import { ERROR_CODES } from '@/lib/errors/codes';
import { toCatalogTaxonomyFacet } from '@/modules/works/taxonomy-mapper';

import { toWork } from './projection';
import {
  loadCategoriesByWorkIds,
  loadCategoryForWork,
  loadPartCountsByWorkIds,
  loadSourcesByWorkIds,
  loadSourcesForWork,
  loadTagsByWorkIds,
  loadTagsForWork,
} from './relations';
import { ensureWorkReadingStatsIfMissing } from './stats';

function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function catalogPublishedWorkFilter(id?: string): SQL {
  return and(
    ...(id ? [eq(readingWorkTable.id, id)] : []),
    eq(readingWorkTable.status, 'published'),
    eq(readingWorkTable.visibility, 'catalog'),
  )!;
}

function publishedListWhere(query: Pick<CatalogListQuery, 'tag' | 'category' | 'q'>): SQL {
  const parts: SQL[] = [catalogPublishedWorkFilter()];

  if (query.category) {
    parts.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(readingWorkCategoryTable)
          .where(
            and(
              eq(readingWorkCategoryTable.workId, readingWorkTable.id),
              eq(readingWorkCategoryTable.categoryId, query.category),
            ),
          ),
      ),
    );
  }

  if (query.tag && query.tag.length > 0) {
    parts.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(readingWorkTagTable)
          .where(
            and(eq(readingWorkTagTable.workId, readingWorkTable.id), inArray(readingWorkTagTable.tagId, query.tag)),
          ),
      ),
    );
  }

  if (query.q) {
    const pattern = `%${escapeIlikePattern(query.q)}%`;
    parts.push(
      or(
        ilike(readingWorkTable.title, pattern),
        exists(
          db
            .select({ one: sql`1` })
            .from(readingWorkTagTable)
            .innerJoin(tagTable, eq(readingWorkTagTable.tagId, tagTable.id))
            .where(and(eq(readingWorkTagTable.workId, readingWorkTable.id), ilike(tagTable.name, pattern))),
        ),
      )!,
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

async function listCatalogTaxonomyFacets(kind: 'tag' | 'category'): Promise<CatalogTaxonomyListData> {
  const dimensionTable = kind === 'tag' ? tagTable : categoryTable;
  const linkTable = kind === 'tag' ? readingWorkTagTable : readingWorkCategoryTable;
  const linkKey = kind === 'tag' ? readingWorkTagTable.tagId : readingWorkCategoryTable.categoryId;

  const rows = await db
    .selectDistinct({
      id: dimensionTable.id,
      name: dimensionTable.name,
      localizedNames: dimensionTable.localizedNames,
      origin: dimensionTable.origin,
    })
    .from(linkTable)
    .innerJoin(dimensionTable, eq(linkKey, dimensionTable.id))
    .innerJoin(readingWorkTable, eq(linkTable.workId, readingWorkTable.id))
    .where(catalogPublishedWorkFilter())
    .orderBy(asc(dimensionTable.name));

  return {
    items: rows.map((row) => toCatalogTaxonomyFacet(row)),
  };
}

export async function listCatalogTags(): Promise<CatalogTaxonomyListData> {
  return listCatalogTaxonomyFacets('tag');
}

export async function listCatalogCategories(): Promise<CatalogTaxonomyListData> {
  return listCatalogTaxonomyFacets('category');
}

export async function listCatalogWorks(query: CatalogListQuery): Promise<CatalogListData> {
  const where = publishedListWhere(query);
  const orderBy = publishedListOrderBy(query);
  const offset = (query.page - 1) * query.pageSize;

  const [countRow] = await db.select({ value: count() }).from(readingWorkTable).where(where);
  const total = Number(countRow?.value ?? 0);

  const rows = await db
    .select()
    .from(readingWorkTable)
    .where(where)
    .orderBy(...orderBy)
    .limit(query.pageSize)
    .offset(offset);

  const workIds = rows.map((row) => row.id);
  const [tagsByWork, categoriesByWork, sourcesByWork, partCountsByWork] = await Promise.all([
    loadTagsByWorkIds(workIds),
    loadCategoriesByWorkIds(workIds),
    loadSourcesByWorkIds(workIds),
    loadPartCountsByWorkIds(workIds),
  ]);

  return {
    items: rows.map((row) => ({
      ...toWork(
        row,
        tagsByWork.get(row.id) ?? [],
        sourcesByWork.get(row.id) ?? [],
        categoriesByWork.get(row.id) ?? null,
      ),
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

export async function getPublishedWork(id: string): Promise<Work> {
  const [row] = await db.select().from(readingWorkTable).where(catalogPublishedWorkFilter(id)).limit(1);

  if (!row) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
  }
  const hydrated = await ensureWorkReadingStatsIfMissing(row);
  const [tags, category, sources] = await Promise.all([
    loadTagsForWork(id),
    loadCategoryForWork(id),
    loadSourcesForWork(id),
  ]);
  return toWork(hydrated, tags, sources, category);
}

/** Resolve only catalog-visible metadata for request-scoped public context. */
export async function getPublishedWorkTitle(id: string): Promise<string | undefined> {
  const [row] = await db
    .select({ title: readingWorkTable.title })
    .from(readingWorkTable)
    .where(catalogPublishedWorkFilter(id))
    .limit(1);
  return row?.title;
}
