import { and, eq, isNull, type SQL } from 'drizzle-orm';

import { readingWork as readingWorkTable } from '@gloaming/db';

/** Catalog operations apply only to ownerless Works whose visibility is catalog. */
export function catalogWorkPredicate(): SQL {
  return and(isNull(readingWorkTable.ownerUserId), eq(readingWorkTable.visibility, 'catalog'))!;
}

export function isCatalogWork(row: { ownerUserId: string | null; visibility: string }): boolean {
  return row.ownerUserId === null && row.visibility === 'catalog';
}
