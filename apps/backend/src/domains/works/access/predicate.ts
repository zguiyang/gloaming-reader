import { and, eq, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm';

import { readingWork as readingWorkTable } from '@gloaming/db';
import { sourceRecord as sourceRecordTable, userLibraryItem as userLibraryItemTable } from '@gloaming/db/schema';

import type { WorkReadActor } from '@/domains/works/access/actor';

export type WorkAccessRow = {
  ownerUserId: string | null;
  visibility: string;
  publishedAt: Date | null;
};

/** Catalog work readable by non-owners when officially published. */
export function isPublicCatalogWork(row: WorkAccessRow): boolean {
  return row.ownerUserId == null && row.visibility === 'catalog' && row.publishedAt != null;
}

/** SQL for official public Catalog works (`owner_user_id` IS NULL, published catalog). */
export function publicCatalogWorkSql(): SQL {
  return and(
    isNull(readingWorkTable.ownerUserId),
    eq(readingWorkTable.visibility, 'catalog'),
    isNotNull(readingWorkTable.publishedAt),
  )!;
}

/**
 * An unpublished, ownerless, catalog-visible Work that is linked from a
 * `source_record`. Only this class of Work is readable through a Library
 * membership: a membership must never unlock another user's Personal Work, an
 * unlinked Work, or a private Work.
 */
function membershipSourceWorkSql(): SQL {
  return and(
    isNull(readingWorkTable.ownerUserId),
    eq(readingWorkTable.visibility, 'catalog'),
    isNull(readingWorkTable.publishedAt),
    sql`exists (
      select 1 from ${sourceRecordTable}
      where ${sourceRecordTable.workId} = ${readingWorkTable.id}
    )`,
  )!;
}

/** This actor's own Library membership for the Work. */
function ownMembershipSql(userId: string): SQL {
  return sql`exists (
    select 1 from ${userLibraryItemTable}
    where ${userLibraryItemTable.workId} = ${readingWorkTable.id}
      and ${userLibraryItemTable.userId} = ${userId}
  )`;
}

/**
 * The single central Work Access Policy shared by Reader parts, the asset
 * gateway, reading history, catalog detail, and conversation subjects:
 *
 * - Personal Work: readable only by its `owner_user_id`.
 * - Published ownerless Catalog Work: publicly readable.
 * - Unpublished ownerless Source-materialized Work: readable only through this
 *   actor's own `user_library_item` membership.
 *
 * Exactly `owner OR published public Catalog OR (own membership AND unpublished
 * linked Source Work)`. The Admin role never grants content access by itself.
 */
export function workReadAccessSql(actor: WorkReadActor): SQL | undefined {
  const parts: SQL[] = [publicCatalogWorkSql()];
  if (actor.userId) {
    parts.push(eq(readingWorkTable.ownerUserId, actor.userId));
    parts.push(and(ownMembershipSql(actor.userId), membershipSourceWorkSql())!);
  }
  return or(...parts)!;
}
