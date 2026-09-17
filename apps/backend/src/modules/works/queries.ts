import { and, asc, count, desc, eq, exists, ilike, inArray, or, type SQL, sql } from 'drizzle-orm';

import {
  category as categoryTable,
  readingPart as readingPartTable,
  readingWork as readingWorkTable,
  readingWorkCategory as readingWorkCategoryTable,
  readingWorkSource as readingWorkSourceTable,
  readingWorkTag as readingWorkTagTable,
  source as sourceTable,
  tag as tagTable,
} from '@gloaming/db';
import { buildPaginationMeta } from '@gloaming/shared/pagination';
import type { CatalogTaxonomyListData, SourceReference, TaxonomyReference } from '@gloaming/shared/taxonomy';
import { type CatalogListData, type CatalogListQuery, type Part, type Work } from '@gloaming/shared/works';

import { db } from '@/db';
import { ERROR_CODES } from '@/lib/error-codes';
import { NotFoundError } from '@/lib/errors';
import { computePartReadingStats, computeWorkReadingStats } from '@/modules/reading-stats/service';
import { toCatalogTaxonomyFacet, toSourceReference, toTaxonomyReference } from '@/modules/works/taxonomy-mapper';

type WorkRow = typeof readingWorkTable.$inferSelect;
export type PartRow = typeof readingPartTable.$inferSelect;

function toIso(value: Date): string {
  return value.toISOString();
}

/** admin_epub re-parse: hide tags in API projection (junction rows are preserved). */
export function shouldHideTagsDuringProcessing(row: WorkRow): boolean {
  return row.originKind === 'admin_epub' && row.status === 'processing';
}

/** Tag references for one work — junction SSOT. */
export async function loadTagsForWork(workId: string): Promise<TaxonomyReference[]> {
  const rows = await db
    .select({
      id: tagTable.id,
      name: tagTable.name,
      localizedNames: tagTable.localizedNames,
      origin: tagTable.origin,
    })
    .from(readingWorkTagTable)
    .innerJoin(tagTable, eq(readingWorkTagTable.tagId, tagTable.id))
    .where(eq(readingWorkTagTable.workId, workId))
    .orderBy(asc(tagTable.name));
  return rows.map((row) => toTaxonomyReference(row));
}

/** Batch tag references keyed by work id. */
export async function loadTagsByWorkIds(workIds: string[]): Promise<Map<string, TaxonomyReference[]>> {
  if (workIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      workId: readingWorkTagTable.workId,
      id: tagTable.id,
      name: tagTable.name,
      localizedNames: tagTable.localizedNames,
      origin: tagTable.origin,
    })
    .from(readingWorkTagTable)
    .innerJoin(tagTable, eq(readingWorkTagTable.tagId, tagTable.id))
    .where(inArray(readingWorkTagTable.workId, workIds))
    .orderBy(asc(tagTable.name));
  const map = new Map<string, TaxonomyReference[]>();
  for (const row of rows) {
    const list = map.get(row.workId) ?? [];
    list.push(toTaxonomyReference(row));
    map.set(row.workId, list);
  }
  return map;
}

export function toWork(
  row: WorkRow,
  tags: TaxonomyReference[],
  sources: SourceReference[],
  category: TaxonomyReference | null = null,
): Work {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    description: row.description,
    language: row.language,
    status: row.status as Work['status'],
    visibility: row.visibility as Work['visibility'],
    originKind: row.originKind as Work['originKind'],
    tags: shouldHideTagsDuringProcessing(row) ? [] : tags,
    category,
    sources,
    coverAssetId: row.coverAssetId,
    wordCount: row.wordCount,
    estimatedMinutes: row.estimatedMinutes,
    suggestedVocabSize: row.suggestedVocabSize,
    difficultyScore: row.difficultyScore,
    statsProvenance: row.statsProvenance,
    publishedAt: row.publishedAt ? toIso(row.publishedAt) : null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export function toPart(row: PartRow): Part {
  return {
    id: row.id,
    workId: row.workId,
    sortOrder: row.sortOrder,
    kind: row.kind as Part['kind'],
    title: row.title,
    body: row.body,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export async function loadPartsForWork(workId: string): Promise<PartRow[]> {
  return db
    .select()
    .from(readingPartTable)
    .where(eq(readingPartTable.workId, workId))
    .orderBy(asc(readingPartTable.sortOrder), asc(readingPartTable.id));
}

/** Batch part sort orders for chapter progress on shelf/history surfaces. */
export async function loadPartSortOrdersByWorkIds(workIds: string[]): Promise<Map<string, { sortOrder: number }[]>> {
  if (workIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ workId: readingPartTable.workId, sortOrder: readingPartTable.sortOrder })
    .from(readingPartTable)
    .where(inArray(readingPartTable.workId, workIds))
    .orderBy(asc(readingPartTable.sortOrder), asc(readingPartTable.id));
  const map = new Map<string, { sortOrder: number }[]>();
  for (const row of rows) {
    const list = map.get(row.workId) ?? [];
    list.push({ sortOrder: row.sortOrder });
    map.set(row.workId, list);
  }
  return map;
}

async function loadPartCountsByWorkIds(workIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const id of workIds) {
    map.set(id, 0);
  }
  if (workIds.length === 0) {
    return map;
  }
  const rows = await db
    .select({ workId: readingPartTable.workId, value: count() })
    .from(readingPartTable)
    .where(inArray(readingPartTable.workId, workIds))
    .groupBy(readingPartTable.workId);
  for (const row of rows) {
    map.set(row.workId, Number(row.value));
  }
  return map;
}

/** Batch source references keyed by work id. */
export async function loadSourcesByWorkIds(workIds: string[]): Promise<Map<string, SourceReference[]>> {
  if (workIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      workId: readingWorkSourceTable.workId,
      id: sourceTable.id,
      name: sourceTable.name,
      origin: sourceTable.origin,
      matchRule: sourceTable.matchRule,
    })
    .from(readingWorkSourceTable)
    .innerJoin(sourceTable, eq(readingWorkSourceTable.sourceId, sourceTable.id))
    .where(inArray(readingWorkSourceTable.workId, workIds))
    .orderBy(asc(sourceTable.name));
  const map = new Map<string, SourceReference[]>();
  for (const row of rows) {
    const list = map.get(row.workId) ?? [];
    list.push(toSourceReference(row));
    map.set(row.workId, list);
  }
  return map;
}

export async function loadSourcesForWork(workId: string): Promise<SourceReference[]> {
  const rows = await db
    .select({
      id: sourceTable.id,
      name: sourceTable.name,
      origin: sourceTable.origin,
      matchRule: sourceTable.matchRule,
    })
    .from(readingWorkSourceTable)
    .innerJoin(sourceTable, eq(readingWorkSourceTable.sourceId, sourceTable.id))
    .where(eq(readingWorkSourceTable.workId, workId))
    .orderBy(asc(sourceTable.name));
  return rows.map((row) => toSourceReference(row));
}

export async function loadCategoriesByWorkIds(workIds: string[]): Promise<Map<string, TaxonomyReference>> {
  if (workIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      workId: readingWorkCategoryTable.workId,
      id: categoryTable.id,
      name: categoryTable.name,
      localizedNames: categoryTable.localizedNames,
      origin: categoryTable.origin,
    })
    .from(readingWorkCategoryTable)
    .innerJoin(categoryTable, eq(readingWorkCategoryTable.categoryId, categoryTable.id))
    .where(inArray(readingWorkCategoryTable.workId, workIds));
  const map = new Map<string, TaxonomyReference>();
  for (const row of rows) {
    if (!map.has(row.workId)) {
      map.set(row.workId, toTaxonomyReference(row));
    }
  }
  return map;
}

/** Current category reference (single-select) or null when unset. */
export async function loadCategoryForWork(workId: string): Promise<TaxonomyReference | null> {
  const [row] = await db
    .select({
      id: categoryTable.id,
      name: categoryTable.name,
      localizedNames: categoryTable.localizedNames,
      origin: categoryTable.origin,
    })
    .from(readingWorkCategoryTable)
    .innerJoin(categoryTable, eq(readingWorkCategoryTable.categoryId, categoryTable.id))
    .where(eq(readingWorkCategoryTable.workId, workId))
    .limit(1);
  return row ? toTaxonomyReference(row) : null;
}

/** Backfill stats for works parsed before reading_work stats columns existed. */
async function ensureWorkReadingStatsIfMissing(row: WorkRow): Promise<WorkRow> {
  if (row.wordCount != null) {
    return row;
  }

  const parts = await loadPartsForWork(row.id);
  if (parts.length === 0) {
    return row;
  }

  const preserveManualStats = row.statsProvenance === 'manual';
  const workStats = computeWorkReadingStats(
    parts.map((part) => ({ body: part.body })),
    row.language,
  );

  await db.transaction(async (tx) => {
    for (const part of parts) {
      const meta = part.meta as { wordCount?: unknown };
      if (typeof meta.wordCount === 'number') {
        continue;
      }
      const partStats = computePartReadingStats(part.body);
      await tx
        .update(readingPartTable)
        .set({ meta: { wordCount: partStats.wordCount } })
        .where(eq(readingPartTable.id, part.id));
    }

    await tx
      .update(readingWorkTable)
      .set({
        wordCount: workStats.wordCount,
        estimatedMinutes: workStats.estimatedMinutes,
        ...(preserveManualStats
          ? {}
          : {
              suggestedVocabSize: workStats.suggestedVocabSize,
              difficultyScore: workStats.difficultyScore,
              statsProvenance: workStats.statsProvenance,
            }),
      })
      .where(eq(readingWorkTable.id, row.id));
  });

  const [updated] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, row.id)).limit(1);
  return updated ?? row;
}

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

export async function requirePublishedWorkWithParts(workId: string): Promise<{ work: WorkRow; parts: PartRow[] }> {
  const [work] = await db
    .select()
    .from(readingWorkTable)
    .where(and(eq(readingWorkTable.id, workId), eq(readingWorkTable.status, 'published')))
    .limit(1);
  if (!work) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
  }
  const hydrated = await ensureWorkReadingStatsIfMissing(work);
  const parts = await loadPartsForWork(workId);
  if (parts.length === 0) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.PART);
  }
  return { work: hydrated, parts };
}

export async function getPartById(partId: string): Promise<PartRow> {
  const [row] = await db.select().from(readingPartTable).where(eq(readingPartTable.id, partId)).limit(1);
  if (!row) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.PART);
  }
  return row;
}
