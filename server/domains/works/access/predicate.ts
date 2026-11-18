import { and, eq, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm';

import { readingWork as readingWorkTable } from '@/server/db';
import { userLibraryItem as userLibraryItemTable } from '@/server/db/schema';

import type { WorkReadActor } from '@/server/domains/works/access/actor';

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

/** Ownerless catalog Work (published or not) — readable via the actor's own membership. */
function membershipCatalogWorkSql(): SQL {
  return and(isNull(readingWorkTable.ownerUserId), eq(readingWorkTable.visibility, 'catalog'))!;
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
 * Central Work Access Policy:
 *
 * - Personal Work: readable only by its `owner_user_id`.
 * - Published ownerless Catalog Work: publicly readable.
 * - Other ownerless Catalog Works: readable only through this actor's own
 *   `user_library_item` membership (legacy saved catalog works in the library).
 *
 * The Admin role never grants content access by itself.
 */
export function workReadAccessSql(actor: WorkReadActor): SQL | undefined {
  const parts: SQL[] = [publicCatalogWorkSql()];
  if (actor.userId) {
    parts.push(eq(readingWorkTable.ownerUserId, actor.userId));
    parts.push(and(ownMembershipSql(actor.userId), membershipCatalogWorkSql())!);
  }
  return or(...parts)!;
}
