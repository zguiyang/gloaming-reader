import { asc, count, eq, inArray } from 'drizzle-orm';

import { readingPart as readingPartTable } from '@gloaming/db';

import { db } from '@/infra/db';

import type { PartRow } from './projection';

export async function loadPartsForWork(workId: string): Promise<PartRow[]> {
  return db
    .select()
    .from(readingPartTable)
    .where(eq(readingPartTable.workId, workId))
    .orderBy(asc(readingPartTable.sortOrder), asc(readingPartTable.id));
}

/** Batch part sort orders for chapter progress on shelf/history surfaces. */
export async function loadPartSortOrdersByWorkIds(workIds: string[]): Promise<Map<string, { sortOrder: number }[]>> {
  if (workIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ workId: readingPartTable.workId, sortOrder: readingPartTable.sortOrder })
    .from(readingPartTable)
    .where(inArray(readingPartTable.workId, workIds))
    .orderBy(asc(readingPartTable.sortOrder), asc(readingPartTable.id));
  const map = new Map<string, { sortOrder: number }[]>();
  for (const row of rows) {
    const list = map.get(row.workId) ?? [];
    list.push({ sortOrder: row.sortOrder });
    map.set(row.workId, list);
  }
  return map;
}

export async function loadPartCountsByWorkIds(workIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const id of workIds) {
    map.set(id, 0);
  }
  if (workIds.length === 0) {
    return map;
  }
  const rows = await db
    .select({ workId: readingPartTable.workId, value: count() })
    .from(readingPartTable)
    .where(inArray(readingPartTable.workId, workIds))
    .groupBy(readingPartTable.workId);
  for (const row of rows) {
    map.set(row.workId, Number(row.value));
  }
  return map;
}
