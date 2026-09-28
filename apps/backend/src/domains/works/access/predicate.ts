import { and, eq, isNotNull, isNull, or, type SQL } from 'drizzle-orm';

import { readingWork as readingWorkTable } from '@gloaming/db';

import type { WorkReadActor } from '@/domains/works/access/actor';
import { isWorkReadAdmin } from '@/domains/works/access/actor';

export type WorkAccessRow = {
  ownerUserId: string | null;
  visibility: string;
  publishedAt: Date | null;
};

/** Catalog work readable by non-owners when officially published. */
export function isPublicCatalogWork(row: WorkAccessRow): boolean {
  return row.ownerUserId == null && row.visibility === 'catalog' && row.publishedAt != null;
}

export function canReadWorkRow(actor: WorkReadActor, row: WorkAccessRow): boolean {
  if (isWorkReadAdmin(actor)) {
    return true;
  }
  if (actor.userId && row.ownerUserId === actor.userId) {
    return true;
  }
  return isPublicCatalogWork(row);
}

/** SQL for official public Catalog works (`owner_user_id` IS NULL, published catalog). */
export function publicCatalogWorkSql(): SQL {
  return and(
    isNull(readingWorkTable.ownerUserId),
    eq(readingWorkTable.visibility, 'catalog'),
    isNotNull(readingWorkTable.publishedAt),
  )!;
}

/** Drizzle predicate for `reading_work` rows the actor may read. */
export function workReadAccessSql(actor: WorkReadActor): SQL | undefined {
  if (isWorkReadAdmin(actor)) {
    return undefined;
  }
  const publicCatalog = publicCatalogWorkSql();
  if (actor.userId) {
    return or(eq(readingWorkTable.ownerUserId, actor.userId), publicCatalog)!;
  }
  return publicCatalog;
}
