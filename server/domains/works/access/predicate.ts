import { eq, or, type SQL, sql } from 'drizzle-orm';

import { readingWork as readingWorkTable } from '@/server/db';
import { userLibraryItem as userLibraryItemTable } from '@/server/db/schema';

import type { WorkReadActor } from '@/server/domains/works/access/actor';

/** This actor's own Library membership for the Work. */
function ownMembershipSql(userId: string): SQL {
  return sql`exists (
    select 1 from ${userLibraryItemTable}
    where ${userLibraryItemTable.workId} = ${readingWorkTable.id}
      and ${userLibraryItemTable.userId} = ${userId}
  )`;
}

/**
 * Central Work Access Policy (authenticated personal library only):
 *
 * - Personal Work: readable only by its `owner_user_id`.
 * - Any other readable Work: the actor has a `user_library_item` row.
 *
 * There is no anonymous or public-catalog read path. The Admin role never
 * grants content access by itself.
 */
export function workReadAccessSql(actor: WorkReadActor): SQL | undefined {
  return or(eq(readingWorkTable.ownerUserId, actor.userId), ownMembershipSql(actor.userId))!;
}
