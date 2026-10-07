import { and, count, desc, eq, ilike, or, type SQL, sql } from 'drizzle-orm';

import { discoverySource, sourceRecord } from '@gloaming/db/schema';
import type {
  SourceRecordDetail,
  SourceRecordItem,
  SourceRecordListData,
  SourceRecordListQuery,
} from '@gloaming/shared/discovery';
import { buildPaginationMeta } from '@gloaming/shared/pagination';

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

function listWhere(query: SourceRecordListQuery): SQL {
  const parts: SQL[] = [availableRecordFilter(), enabledSourceFilter(), languageFilter(query.language)];
  if (query.q) {
    parts.push(searchFilter(query.q));
  }
  return and(...parts)!;
}

function listOrderBy(query: SourceRecordListQuery): SQL[] {
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

export async function listSourceRecords(query: SourceRecordListQuery): Promise<SourceRecordListData> {
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

  return {
    items: rows.map((row) => toSourceRecordItem(row.record, row.source)),
    pagination: buildPaginationMeta({
      page: query.page,
      pageSize: query.pageSize,
      total,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    }),
  };
}

export async function getSourceRecord(sourceRecordId: string): Promise<SourceRecordDetail> {
  const [row] = await db
    .select({ record: sourceRecord, source: discoverySource })
    .from(sourceRecord)
    .innerJoin(discoverySource, eq(sourceRecord.sourceId, discoverySource.id))
    .where(and(eq(sourceRecord.id, sourceRecordId), availableRecordFilter(), enabledSourceFilter()))
    .limit(1);

  if (!row) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.SOURCE_RECORD);
  }
  return toSourceRecordDetail(row.record, row.source);
}
