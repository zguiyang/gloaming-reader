import { and, count, desc, eq, ilike, or, type SQL, sql } from 'drizzle-orm';

import { discoverySource, sourceRecord } from '@gloaming/db/schema';
import { DEFAULT_LOCALE } from '@gloaming/i18n';
import type {
  CategorySourceRecordListQuery,
  SourceRecordDetail,
  SourceRecordItem,
  SourceRecordListData,
  SourceRecordListQuery,
} from '@gloaming/shared/discovery';
import { buildPaginationMeta } from '@gloaming/shared/pagination';

import { loadCategorySummariesByRecordIds } from '@/domains/discovery/categories/repository';
import { db } from '@/infra/db';
import { NotFoundError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

type DiscoverySourceRow = typeof discoverySource.$inferSelect;
type SourceRecordRow = typeof sourceRecord.$inferSelect;

function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** Only records the last successful sync observed as available are discoverable. */
function availableRecordFilter(): SQL {
  return eq(sourceRecord.availability, 'available');
}

/** A source must be enabled for any of its records to be publicly readable. */
function enabledSourceFilter(): SQL {
  return eq(discoverySource.enabled, true);
}

/** English-first via the existing `languages` GIN index; persisted rows are untouched. */
function languageFilter(language: string): SQL {
  return sql`${sourceRecord.languages} @> ARRAY[${language}]::text[]`;
}

/** Matches title, author display names, and the source-scoped external id. */
function searchFilter(term: string): SQL {
  const pattern = `%${escapeIlikePattern(term)}%`;
  return or(
    ilike(sourceRecord.title, pattern),
    ilike(sourceRecord.externalId, pattern),
    sql`EXISTS (
      SELECT 1 FROM jsonb_array_elements(${sourceRecord.authors}) AS author
      WHERE author->>'name' ILIKE ${pattern}
    )`,
  )!;
}

/** Matches records that carry a public category assignment. */
function categoryFilter(categoryId: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM source_record_public_category assigned
    WHERE assigned.source_record_id = ${sourceRecord.id} AND assigned.category_id = ${categoryId}
  )`;
}

function listWhere(query: SourceRecordListQuery): SQL {
  const parts: SQL[] = [availableRecordFilter(), enabledSourceFilter(), languageFilter(query.language)];
  if (query.q) {
    parts.push(searchFilter(query.q));
  }
  if (query.categoryId) {
    parts.push(categoryFilter(query.categoryId));
  }
  return and(...parts)!;
}

function listOrderBy(query: Pick<SourceRecordListQuery, 'sortBy' | 'sortOrder'>): SQL[] {
  const column =
    query.sortBy === 'title'
      ? sourceRecord.title
      : query.sortBy === 'updatedAt'
        ? sourceRecord.updatedAt
        : sourceRecord.sourceUpdatedAt;
  const primary = query.sortOrder === 'asc' ? sql`${column} asc nulls last` : sql`${column} desc nulls last`;
  return [primary, desc(sourceRecord.id)];
}

function toSourceRecordItem(record: SourceRecordRow, source: DiscoverySourceRow): SourceRecordItem {
  return {
    sourceRecordId: record.id,
    linkedWorkId: record.workId,
    sourceId: record.sourceId,
    sourceKey: source.sourceKey,
    sourceType: source.sourceType,
    externalId: record.externalId,
    title: record.title,
    authors: record.authors,
    languages: record.languages,
    description: record.description,
    coverUrl: record.coverUrl,
    availability: record.availability,
    sourceUpdatedAt: record.sourceUpdatedAt,
    lastSeenAt: record.lastSeenAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toSourceRecordDetail(record: SourceRecordRow, source: DiscoverySourceRow): SourceRecordDetail {
  return {
    ...toSourceRecordItem(record, source),
    rightsStatement: record.rightsStatement,
    contentCandidates: record.contentCandidates,
    sourceMeta: record.sourceMeta,
  };
}

export type SourceRecordReadOptions = {
  /** Locale for the public category display summaries; defaults to the product locale. */
  locale?: string;
};

export async function listSourceRecords(
  query: SourceRecordListQuery,
  options: SourceRecordReadOptions = {},
): Promise<SourceRecordListData> {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const where = listWhere(query);
  const offset = (query.page - 1) * query.pageSize;

  const [countRow] = await db
    .select({ value: count() })
    .from(sourceRecord)
    .innerJoin(discoverySource, eq(sourceRecord.sourceId, discoverySource.id))
    .where(where);
  const total = Number(countRow?.value ?? 0);

  const rows = await db
    .select({ record: sourceRecord, source: discoverySource })
    .from(sourceRecord)
    .innerJoin(discoverySource, eq(sourceRecord.sourceId, discoverySource.id))
    .where(where)
    .orderBy(...listOrderBy(query))
    .limit(query.pageSize)
    .offset(offset);

  const recordIds = rows.map((row) => row.record.id);
  const categoriesByRecord = await loadCategorySummariesByRecordIds(recordIds, locale);

  return {
    items: rows.map((row) => ({
      ...toSourceRecordItem(row.record, row.source),
      categories: categoriesByRecord.get(row.record.id) ?? [],
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

export async function getSourceRecord(
  sourceRecordId: string,
  options: SourceRecordReadOptions = {},
): Promise<SourceRecordDetail> {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const [row] = await db
    .select({ record: sourceRecord, source: discoverySource })
    .from(sourceRecord)
    .innerJoin(discoverySource, eq(sourceRecord.sourceId, discoverySource.id))
    .where(and(eq(sourceRecord.id, sourceRecordId), availableRecordFilter(), enabledSourceFilter()))
    .limit(1);

  if (!row) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.SOURCE_RECORD);
  }

  const categoriesByRecord = await loadCategorySummariesByRecordIds([row.record.id], locale);
  return {
    ...toSourceRecordDetail(row.record, row.source),
    categories: categoriesByRecord.get(row.record.id) ?? [],
  };
}

/**
 * Admin paginated view of one category's assignments. Unlike the public list it
 * does not filter by availability, source-enabled state, or content language, so
 * instance management sees every assigned SourceRecord. Category summaries are
 * still the minimal localized projection.
 */
export async function listCategorySourceRecords(
  categoryId: string,
  query: CategorySourceRecordListQuery,
  options: SourceRecordReadOptions = {},
): Promise<SourceRecordListData> {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const parts: SQL[] = [categoryFilter(categoryId)];
  if (query.q) {
    parts.push(searchFilter(query.q));
  }
  const where = and(...parts)!;
  const offset = (query.page - 1) * query.pageSize;

  const [countRow] = await db
    .select({ value: count() })
    .from(sourceRecord)
    .innerJoin(discoverySource, eq(sourceRecord.sourceId, discoverySource.id))
    .where(where);
  const total = Number(countRow?.value ?? 0);

  const rows = await db
    .select({ record: sourceRecord, source: discoverySource })
    .from(sourceRecord)
    .innerJoin(discoverySource, eq(sourceRecord.sourceId, discoverySource.id))
    .where(where)
    .orderBy(...listOrderBy(query))
    .limit(query.pageSize)
    .offset(offset);

  const categoriesByRecord = await loadCategorySummariesByRecordIds(
    rows.map((row) => row.record.id),
    locale,
  );

  return {
    items: rows.map((row) => ({
      ...toSourceRecordItem(row.record, row.source),
      categories: categoriesByRecord.get(row.record.id) ?? [],
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
