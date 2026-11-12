import { and, eq, inArray } from 'drizzle-orm';

import {
  discoverySource as discoverySourceTable,
  readingWork as readingWorkTable,
  sourceRecord as sourceRecordTable,
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

import { PROJECT_GUTENBERG_SOURCE_KEY } from '@/server/domains/discovery/gutenberg/constants';
import {
  getGutenbergOpdsRecord,
  listGutenbergDiscoveryFacets,
  listGutenbergOpdsRecords,
} from '@/server/domains/discovery/gutenberg/opds-adapter';
import { findSourceRecordByExternalId } from '@/server/domains/discovery/persist/source-record';
import { assertDiscoverySourceEnabled, listEnabledDiscoverySources } from '@/server/domains/discovery/sources/service';
import type { WorkReadActor } from '@/server/domains/works/access';
import { canReadWork } from '@/server/domains/works/access';
import { db } from '@/server/infra/db';
import { NotFoundError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';

type DiscoverReadOptions = {
  locale?: string;
  actor: WorkReadActor;
};

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

async function enrichItemsWithLocalState(
  items: SourceRecordItem[],
  actor: WorkReadActor,
  sourceKey: string,
): Promise<SourceRecordItem[]> {
  if (items.length === 0) return items;

  const externalIds = items.map((item) => item.externalId);
  const rows = await db
    .select({
      id: sourceRecordTable.id,
      externalId: sourceRecordTable.externalId,
      workId: sourceRecordTable.workId,
      sourceId: sourceRecordTable.sourceId,
      processingStatus: readingWorkTable.processingStatus,
    })
    .from(sourceRecordTable)
    .innerJoin(discoverySourceTable, eq(sourceRecordTable.sourceId, discoverySourceTable.id))
    .leftJoin(readingWorkTable, eq(sourceRecordTable.workId, readingWorkTable.id))
    .where(and(eq(discoverySourceTable.sourceKey, sourceKey), inArray(sourceRecordTable.externalId, externalIds)));

  const byExternalId = new Map(rows.map((row) => [row.externalId, row]));

  return Promise.all(
    items.map(async (item) => {
      const local = byExternalId.get(item.externalId);
      if (!local) return item;

      let detailAvailable = false;
      if (local.workId && local.processingStatus && isWorkParseCompleted(local.processingStatus)) {
        detailAvailable = await canReadWork(actor, local.workId);
      }

      return {
        ...item,
        sourceRecordId: local.id,
        sourceId: local.sourceId,
        linkedWorkId: local.workId,
        detailAvailable,
      };
    }),
  );
}

export async function listDiscoveryFacets(sourceKey?: string): Promise<DiscoveryFacetListData> {
  const active = await resolveActiveSourceKey(sourceKey);
  if (!active || active !== PROJECT_GUTENBERG_SOURCE_KEY) {
    return { items: [] };
  }
  return { items: listGutenbergDiscoveryFacets() };
}

export async function listSourceRecords(
  query: SourceRecordListQuery,
  options: DiscoverReadOptions,
): Promise<SourceRecordListData> {
  void options.locale;
  const sourceKey = await resolveActiveSourceKey(query.sourceKey);
  if (!sourceKey) {
    return emptyList(query);
  }

  if (sourceKey === PROJECT_GUTENBERG_SOURCE_KEY) {
    const remote = await listGutenbergOpdsRecords({
      page: query.page,
      pageSize: query.pageSize,
      q: query.q,
      facetId: query.facetId,
      language: query.language,
    });
    const items = await enrichItemsWithLocalState(remote.items, options.actor, sourceKey);
    return { ...remote, items };
  }

  return emptyList(query);
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
      enabled: discoverySourceTable.enabled,
    })
    .from(sourceRecordTable)
    .innerJoin(discoverySourceTable, eq(sourceRecordTable.sourceId, discoverySourceTable.id))
    .where(eq(sourceRecordTable.id, sourceRecordIdOrExternalId))
    .limit(1);

  if (byId) {
    if (!byId.enabled) {
      throw new NotFoundError(ERROR_CODES.NOT_FOUND.SOURCE_RECORD);
    }
    if (byId.sourceKey !== PROJECT_GUTENBERG_SOURCE_KEY) {
      throw new NotFoundError(ERROR_CODES.NOT_FOUND.SOURCE_RECORD);
    }
    const detail = await getGutenbergOpdsRecord(byId.record.externalId);
    const [enriched] = await enrichItemsWithLocalState(
      [
        {
          ...detail,
          sourceRecordId: byId.record.id,
          sourceId: byId.record.sourceId,
          linkedWorkId: byId.record.workId,
        },
      ],
      options.actor,
      byId.sourceKey,
    );
    return {
      ...detail,
      ...enriched,
      contentCandidates:
        byId.record.contentCandidates.length > 0 ? byId.record.contentCandidates : detail.contentCandidates,
      sourceMeta: Object.keys(byId.record.sourceMeta).length > 0 ? byId.record.sourceMeta : detail.sourceMeta,
      rightsStatement: byId.record.rightsStatement ?? detail.rightsStatement,
    };
  }

  if (!/^\d+$/.test(sourceRecordIdOrExternalId)) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.SOURCE_RECORD);
  }

  await assertDiscoverySourceEnabled(PROJECT_GUTENBERG_SOURCE_KEY);
  const detail = await getGutenbergOpdsRecord(sourceRecordIdOrExternalId);
  const local = await findSourceRecordByExternalId(PROJECT_GUTENBERG_SOURCE_KEY, sourceRecordIdOrExternalId);
  const [enriched] = await enrichItemsWithLocalState(
    [
      {
        ...detail,
        sourceRecordId: local?.id ?? null,
        sourceId: local?.sourceId ?? null,
        linkedWorkId: local?.workId ?? null,
      },
    ],
    options.actor,
    PROJECT_GUTENBERG_SOURCE_KEY,
  );
  return { ...detail, ...enriched };
}
