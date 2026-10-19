import { and, count, desc, eq, ilike, inArray, isNotNull, or, type SQL, sql } from 'drizzle-orm';

import { discoverySource, readingWork, sourceRecord } from '@gloaming/db/schema';
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
import { hasSelectableEpubCandidate } from '@/domains/discovery/materialization/epub-candidate';
import {
  availableRecordFilter,
  enabledSourceFilter,
  publicDiscoverableRecordWhere,
} from '@/domains/discovery/read-model/visibility';
import { anonymousWorkReadActor, workReadAccessSql, type WorkReadActor } from '@/domains/works/access';
import { db } from '@/infra/db';
import { NotFoundError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

type DiscoverySourceRow = typeof discoverySource.$inferSelect;
type SourceRecordRow = typeof sourceRecord.$inferSelect;

function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
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
  // Shared visibility scope (availability + enabled source + content language);
  // the public category counts use the same predicate.
  const parts: SQL[] = [publicDiscoverableRecordWhere(query.language)];
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

function toSourceRecordItem(
  record: SourceRecordRow,
  source: DiscoverySourceRow,
  viewerCoverUrl: string | null = null,
): SourceRecordItem {
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
    coverUrl: viewerCoverUrl ?? record.coverUrl,
    availability: record.availability,
    sourceUpdatedAt: record.sourceUpdatedAt,
    lastSeenAt: record.lastSeenAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    // Computed from the selected `content_candidates` row only; the candidates
    // themselves stay off the list DTO and appear solely on the detail projection.
    isSaveable: hasSelectableEpubCandidate({ contentCandidates: record.contentCandidates }),
  };
}

function toSourceRecordDetail(
  record: SourceRecordRow,
  source: DiscoverySourceRow,
  viewerCoverUrl: string | null = null,
): SourceRecordDetail {
  return {
    ...toSourceRecordItem(record, source, viewerCoverUrl),
    rightsStatement: record.rightsStatement,
    contentCandidates: record.contentCandidates,
    sourceMeta: record.sourceMeta,
  };
}

/**
 * Local cover asset URLs for linked Works this viewer may read, decided solely
 * by the central Work Access Policy (the same rule the asset gateway enforces).
 * A Work that is not provably readable for the viewer keeps the source cover
 * URL, so a public browse page never renders an asset its viewer cannot fetch.
 */
async function loadViewerCoverUrls(workIds: Array<string | null>, actor: WorkReadActor): Promise<Map<string, string>> {
  const ids = [...new Set(workIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) {
    return new Map();
  }
  const access = workReadAccessSql(actor);
  if (!access) {
    return new Map();
  }
  const rows = await db
    .select({ id: readingWork.id, coverAssetId: readingWork.coverAssetId })
    .from(readingWork)
    .where(and(inArray(readingWork.id, ids), isNotNull(readingWork.coverAssetId), access));
  return new Map(rows.map((row) => [row.id, `/api/assets/${row.coverAssetId}`]));
}

export type SourceRecordReadOptions = {
  /** Locale for the public category display summaries; defaults to the product locale. */
  locale?: string;
  /**
   * Viewer whose Work access decides whether a linked Work's local cover asset
   * replaces the source cover URL. Defaults to anonymous (public-only covers).
   */
  actor?: WorkReadActor;
};

/** Sort/pagination columns shared by every SourceRecord list surface. */
type SourceRecordPageQuery = Pick<SourceRecordListQuery, 'page' | 'pageSize' | 'sortBy' | 'sortOrder'>;

/**
 * Admin candidate-search query: the public list controls without any visibility
 * or content-language constraint. The admin read model resolves the rows.
 */
export type AdminSourceRecordListQuery = SourceRecordPageQuery & Pick<SourceRecordListQuery, 'q'>;

/** Shared page query for the public, category, and admin SourceRecord list surfaces. */
async function listSourceRecordPage(
  where: SQL,
  query: SourceRecordPageQuery,
  locale: string,
  coverActor?: WorkReadActor | null,
): Promise<SourceRecordListData> {
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
  const coverUrls = coverActor
    ? await loadViewerCoverUrls(
        rows.map((row) => row.record.workId),
        coverActor,
      )
    : null;

  return {
    items: rows.map((row) => ({
      ...toSourceRecordItem(row.record, row.source, coverUrls?.get(row.record.workId ?? '') ?? null),
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

export async function listSourceRecords(
  query: SourceRecordListQuery,
  options: SourceRecordReadOptions = {},
): Promise<SourceRecordListData> {
  const actor = options.actor ?? anonymousWorkReadActor();
  return listSourceRecordPage(listWhere(query), query, options.locale ?? DEFAULT_LOCALE, actor);
}

/** Admin search has no public visibility or language constraint; only `q` narrows it. */
function adminListWhere(query: AdminSourceRecordListQuery): SQL {
  return query.q ? searchFilter(query.q) : sql`true`;
}

/**
 * Admin paginated candidate search over every SourceRecord of every
 * DiscoverySource. Unlike the public Discover list it never filters by record
 * availability, source enabled state, or content language, so instance
 * management can assign categories to records that are not publicly
 * discoverable. It still reads only `source_record` (plus its owning
 * DiscoverySource metadata), so personal/private EPUB works are never
 * candidates.
 */
export async function listAdminSourceRecords(
  query: AdminSourceRecordListQuery,
  options: SourceRecordReadOptions = {},
): Promise<SourceRecordListData> {
  return listSourceRecordPage(adminListWhere(query), query, options.locale ?? DEFAULT_LOCALE);
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
  const coverUrls = await loadViewerCoverUrls([row.record.workId], options.actor ?? anonymousWorkReadActor());
  return {
    ...toSourceRecordDetail(row.record, row.source, coverUrls.get(row.record.workId ?? '') ?? null),
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
  const parts: SQL[] = [categoryFilter(categoryId)];
  if (query.q) {
    parts.push(searchFilter(query.q));
  }
  return listSourceRecordPage(and(...parts)!, query, options.locale ?? DEFAULT_LOCALE);
}
