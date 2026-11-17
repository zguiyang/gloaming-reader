import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';

import {
  discoverySource as discoverySourceTable,
  readingWork as readingWorkTable,
  sourceRecord as sourceRecordTable,
  type SourceRecordAuthor,
  type SourceRecordContentCandidate,
  type SourceRecordSourceMeta,
} from '@/server/db/schema';
import type {
  DiscoveryFacetListData,
  SourceRecordDetail,
  SourceRecordItem,
  SourceRecordListData,
  SourceRecordListQuery,
} from '@/shared/discovery';
import { DEFAULT_SOURCE_RECORD_SORT_BY } from '@/shared/discovery';
import { DEFAULT_SORT_ORDER } from '@/shared/pagination';
import { isWorkParseCompleted } from '@/shared/works';

import { getGutenbergCategoryBookshelf } from '@/server/domains/discovery/gutenberg/category-bookshelves';
import {
  PROJECT_GUTENBERG_SOURCE_KEY,
  PROJECT_GUTENBERG_SOURCE_TYPE,
  projectGutenbergCoverUrl,
  rewriteGutenbergCoverUrlToMirror,
} from '@/server/domains/discovery/gutenberg/constants';
import { listGutenbergDiscoveryFacets } from '@/server/domains/discovery/gutenberg/opds-adapter';
import { hasSelectableEpubCandidate } from '@/server/domains/discovery/materialization/epub-candidate';
import { assertDiscoverySourceEnabled, listEnabledDiscoverySources } from '@/server/domains/discovery/sources/service';
import type { WorkReadActor } from '@/server/domains/works/access';
import { listReadableWorkIds } from '@/server/domains/works/access';
import { db } from '@/server/infra/db';
import { NotFoundError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';

type DiscoverReadOptions = {
  locale?: string;
  actor: WorkReadActor;
};

type SourceRecordRow = typeof sourceRecordTable.$inferSelect;

function emptyList(query: SourceRecordListQuery): SourceRecordListData {
  return {
    items: [],
    hasMore: false,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total: 0,
      totalPages: 0,
      sortBy: query.sortBy ?? DEFAULT_SOURCE_RECORD_SORT_BY,
      sortOrder: query.sortOrder ?? DEFAULT_SORT_ORDER,
    },
  };
}

async function resolveActiveSourceKey(requested?: string): Promise<string | null> {
  const enabled = await listEnabledDiscoverySources();
  if (enabled.items.length === 0) return null;
  if (requested) {
    return enabled.items.some((item) => item.sourceKey === requested) ? requested : null;
  }
  return enabled.items[0]?.sourceKey ?? null;
}

function resolveCoverUrl(externalId: string, coverUrl: string | null): string | null {
  const resolved = coverUrl && coverUrl.length > 0 ? coverUrl : projectGutenbergCoverUrl(externalId);
  return rewriteGutenbergCoverUrlToMirror(resolved) ?? resolved;
}

function toListItem(
  record: SourceRecordRow,
  source: { sourceKey: string; sourceType: string },
  extras?: { detailAvailable?: boolean },
): SourceRecordItem {
  return {
    sourceRecordId: record.id,
    linkedWorkId: record.workId,
    sourceId: record.sourceId,
    sourceKey: source.sourceKey,
    sourceType: source.sourceType,
    externalId: record.externalId,
    title: record.title,
    authors: record.authors as SourceRecordAuthor[],
    languages: record.languages,
    description: record.description,
    coverUrl: resolveCoverUrl(record.externalId, record.coverUrl),
    availability: record.availability,
    sourceUpdatedAt: record.sourceUpdatedAt,
    lastSeenAt: record.lastSeenAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    isSaveable: hasSelectableEpubCandidate({
      contentCandidates: record.contentCandidates as SourceRecordContentCandidate[],
    }),
    detailAvailable: extras?.detailAvailable ?? false,
  };
}

function toDetail(
  record: SourceRecordRow,
  source: { sourceKey: string; sourceType: string },
  extras?: { detailAvailable?: boolean },
): SourceRecordDetail {
  return {
    ...toListItem(record, source, extras),
    rightsStatement: record.rightsStatement,
    contentCandidates: record.contentCandidates as SourceRecordContentCandidate[],
    sourceMeta: record.sourceMeta as SourceRecordSourceMeta,
  };
}

async function enrichDetailAvailability(items: SourceRecordItem[], actor: WorkReadActor): Promise<SourceRecordItem[]> {
  const detailCandidateWorkIds = items.flatMap((item) => (item.linkedWorkId ? [item.linkedWorkId] : []));
  if (detailCandidateWorkIds.length === 0) return items;

  const workRows = await db
    .select({ id: readingWorkTable.id, processingStatus: readingWorkTable.processingStatus })
    .from(readingWorkTable)
    .where(inArray(readingWorkTable.id, detailCandidateWorkIds));

  const completedIds = workRows.flatMap((row) => (isWorkParseCompleted(row.processingStatus) ? [row.id] : []));
  const readableWorkIds = await listReadableWorkIds(actor, completedIds);

  return items.map((item) => ({
    ...item,
    detailAvailable: item.linkedWorkId != null && readableWorkIds.has(item.linkedWorkId),
  }));
}

function buildListFilters(query: SourceRecordListQuery, sourceId: string): SQL[] {
  const filters: SQL[] = [eq(sourceRecordTable.sourceId, sourceId), eq(sourceRecordTable.availability, 'available')];

  const language = query.language?.trim().toLowerCase();
  if (language) {
    filters.push(sql`exists (
      select 1 from unnest(${sourceRecordTable.languages}) as lang(code)
      where lower(lang.code) = ${language}
    )`);
  }

  const term = query.q?.trim();
  if (term) {
    const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
    filters.push(
      or(ilike(sourceRecordTable.title, pattern), sql`${sourceRecordTable.authors}::text ilike ${pattern}`)!,
    );
  }

  if (query.facetId) {
    const shelf = getGutenbergCategoryBookshelf(query.facetId);
    if (shelf) {
      filters.push(sql`(${sourceRecordTable.sourceMeta} -> 'bookshelves') ? ${shelf.name}`);
    } else {
      filters.push(sql`false`);
    }
  }

  return filters;
}

function buildListOrder(query: SourceRecordListQuery) {
  const sortBy = query.sortBy ?? DEFAULT_SOURCE_RECORD_SORT_BY;
  const ascending = (query.sortOrder ?? DEFAULT_SORT_ORDER) === 'asc';
  if (sortBy === 'title') {
    return [
      ascending ? asc(sourceRecordTable.title) : desc(sourceRecordTable.title),
      asc(sourceRecordTable.id),
    ] as const;
  }
  if (sortBy === 'updatedAt') {
    return [
      ascending ? asc(sourceRecordTable.updatedAt) : desc(sourceRecordTable.updatedAt),
      asc(sourceRecordTable.id),
    ] as const;
  }
  // Default Discover order: bounded-index popularity, then sourceUpdatedAt.
  return [
    ascending ? asc(sourceRecordTable.popularityScore) : desc(sourceRecordTable.popularityScore),
    ascending ? asc(sourceRecordTable.sourceUpdatedAt) : desc(sourceRecordTable.sourceUpdatedAt),
    asc(sourceRecordTable.id),
  ] as const;
}

export async function listDiscoveryFacets(sourceKey?: string): Promise<DiscoveryFacetListData> {
  const active = await resolveActiveSourceKey(sourceKey);
  if (!active || active !== PROJECT_GUTENBERG_SOURCE_KEY) {
    return { items: [] };
  }
  return { items: listGutenbergDiscoveryFacets() };
}

/**
 * Discover list reads the bounded local `source_record` index only.
 * Live OPDS is not on the hot path.
 */
export async function listSourceRecords(
  query: SourceRecordListQuery,
  options: DiscoverReadOptions,
): Promise<SourceRecordListData> {
  void options.locale;
  const sourceKey = await resolveActiveSourceKey(query.sourceKey);
  if (!sourceKey) {
    return emptyList(query);
  }

  const [source] = await db
    .select()
    .from(discoverySourceTable)
    .where(and(eq(discoverySourceTable.sourceKey, sourceKey), eq(discoverySourceTable.enabled, true)))
    .limit(1);
  if (!source) {
    return emptyList(query);
  }

  const whereClause = and(...buildListFilters(query, source.id))!;
  const sortBy = query.sortBy ?? DEFAULT_SOURCE_RECORD_SORT_BY;
  const sortOrder = query.sortOrder ?? DEFAULT_SORT_ORDER;
  const offset = (query.page - 1) * query.pageSize;

  const [totalRow] = await db.select({ value: count() }).from(sourceRecordTable).where(whereClause);
  const total = Number(totalRow?.value ?? 0);
  if (total === 0) {
    return emptyList(query);
  }

  const rows = await db
    .select()
    .from(sourceRecordTable)
    .where(whereClause)
    .orderBy(...buildListOrder(query))
    .limit(query.pageSize)
    .offset(offset);

  const baseItems = rows.map((record) =>
    toListItem(record, { sourceKey: source.sourceKey, sourceType: source.sourceType || PROJECT_GUTENBERG_SOURCE_TYPE }),
  );
  const items = await enrichDetailAvailability(baseItems, options.actor);
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));

  return {
    items,
    hasMore: query.page * query.pageSize < total,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages,
      sortBy,
      sortOrder,
    },
  };
}

export async function getSourceRecord(
  sourceRecordIdOrExternalId: string,
  options: DiscoverReadOptions,
): Promise<SourceRecordDetail> {
  void options.locale;

  const [byId] = await db
    .select({
      record: sourceRecordTable,
      sourceKey: discoverySourceTable.sourceKey,
      sourceType: discoverySourceTable.sourceType,
      enabled: discoverySourceTable.enabled,
    })
    .from(sourceRecordTable)
    .innerJoin(discoverySourceTable, eq(sourceRecordTable.sourceId, discoverySourceTable.id))
    .where(eq(sourceRecordTable.id, sourceRecordIdOrExternalId))
    .limit(1);

  if (byId) {
    if (!byId.enabled || byId.record.availability !== 'available') {
      throw new NotFoundError(ERROR_CODES.NOT_FOUND.SOURCE_RECORD);
    }
    const [enriched] = await enrichDetailAvailability(
      [
        toListItem(byId.record, {
          sourceKey: byId.sourceKey,
          sourceType: byId.sourceType || PROJECT_GUTENBERG_SOURCE_TYPE,
        }),
      ],
      options.actor,
    );
    return toDetail(
      byId.record,
      { sourceKey: byId.sourceKey, sourceType: byId.sourceType || PROJECT_GUTENBERG_SOURCE_TYPE },
      { detailAvailable: enriched?.detailAvailable },
    );
  }

  if (!/^\d+$/.test(sourceRecordIdOrExternalId)) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.SOURCE_RECORD);
  }

  await assertDiscoverySourceEnabled(PROJECT_GUTENBERG_SOURCE_KEY);
  const [byExternal] = await db
    .select({
      record: sourceRecordTable,
      sourceKey: discoverySourceTable.sourceKey,
      sourceType: discoverySourceTable.sourceType,
      enabled: discoverySourceTable.enabled,
    })
    .from(sourceRecordTable)
    .innerJoin(discoverySourceTable, eq(sourceRecordTable.sourceId, discoverySourceTable.id))
    .where(
      and(
        eq(discoverySourceTable.sourceKey, PROJECT_GUTENBERG_SOURCE_KEY),
        eq(sourceRecordTable.externalId, sourceRecordIdOrExternalId),
        eq(sourceRecordTable.availability, 'available'),
      ),
    )
    .limit(1);

  if (!byExternal || !byExternal.enabled) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.SOURCE_RECORD);
  }

  const [enriched] = await enrichDetailAvailability(
    [
      toListItem(byExternal.record, {
        sourceKey: byExternal.sourceKey,
        sourceType: byExternal.sourceType || PROJECT_GUTENBERG_SOURCE_TYPE,
      }),
    ],
    options.actor,
  );
  return toDetail(
    byExternal.record,
    {
      sourceKey: byExternal.sourceKey,
      sourceType: byExternal.sourceType || PROJECT_GUTENBERG_SOURCE_TYPE,
    },
    { detailAvailable: enriched?.detailAvailable },
  );
}
