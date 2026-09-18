import { asc, count, eq, inArray } from 'drizzle-orm';

import {
  category as categoryTable,
  readingPart as readingPartTable,
  readingWorkCategory as readingWorkCategoryTable,
  readingWorkSource as readingWorkSourceTable,
  readingWorkTag as readingWorkTagTable,
  source as sourceTable,
  tag as tagTable,
} from '@gloaming/db';
import type { SourceReference, TaxonomyReference } from '@gloaming/shared/taxonomy';

import { db } from '@/db';
import { toSourceReference, toTaxonomyReference } from '@/modules/works/taxonomy-mapper';

import type { PartRow } from './projection';

/** Tag references for one work — junction SSOT. */
export async function loadTagsForWork(workId: string): Promise<TaxonomyReference[]> {
  const rows = await db
    .select({
      id: tagTable.id,
      name: tagTable.name,
      localizedNames: tagTable.localizedNames,
      origin: tagTable.origin,
    })
    .from(readingWorkTagTable)
    .innerJoin(tagTable, eq(readingWorkTagTable.tagId, tagTable.id))
    .where(eq(readingWorkTagTable.workId, workId))
    .orderBy(asc(tagTable.name));
  return rows.map((row) => toTaxonomyReference(row));
}

/** Batch tag references keyed by work id. */
export async function loadTagsByWorkIds(workIds: string[]): Promise<Map<string, TaxonomyReference[]>> {
  if (workIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      workId: readingWorkTagTable.workId,
      id: tagTable.id,
      name: tagTable.name,
      localizedNames: tagTable.localizedNames,
      origin: tagTable.origin,
    })
    .from(readingWorkTagTable)
    .innerJoin(tagTable, eq(readingWorkTagTable.tagId, tagTable.id))
    .where(inArray(readingWorkTagTable.workId, workIds))
    .orderBy(asc(tagTable.name));
  const map = new Map<string, TaxonomyReference[]>();
  for (const row of rows) {
    const list = map.get(row.workId) ?? [];
    list.push(toTaxonomyReference(row));
    map.set(row.workId, list);
  }
  return map;
}

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

/** Batch source references keyed by work id. */
export async function loadSourcesByWorkIds(workIds: string[]): Promise<Map<string, SourceReference[]>> {
  if (workIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      workId: readingWorkSourceTable.workId,
      id: sourceTable.id,
      name: sourceTable.name,
      origin: sourceTable.origin,
      matchRule: sourceTable.matchRule,
    })
    .from(readingWorkSourceTable)
    .innerJoin(sourceTable, eq(readingWorkSourceTable.sourceId, sourceTable.id))
    .where(inArray(readingWorkSourceTable.workId, workIds))
    .orderBy(asc(sourceTable.name));
  const map = new Map<string, SourceReference[]>();
  for (const row of rows) {
    const list = map.get(row.workId) ?? [];
    list.push(toSourceReference(row));
    map.set(row.workId, list);
  }
  return map;
}

export async function loadSourcesForWork(workId: string): Promise<SourceReference[]> {
  const rows = await db
    .select({
      id: sourceTable.id,
      name: sourceTable.name,
      origin: sourceTable.origin,
      matchRule: sourceTable.matchRule,
    })
    .from(readingWorkSourceTable)
    .innerJoin(sourceTable, eq(readingWorkSourceTable.sourceId, sourceTable.id))
    .where(eq(readingWorkSourceTable.workId, workId))
    .orderBy(asc(sourceTable.name));
  return rows.map((row) => toSourceReference(row));
}

export async function loadCategoriesByWorkIds(workIds: string[]): Promise<Map<string, TaxonomyReference>> {
  if (workIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      workId: readingWorkCategoryTable.workId,
      id: categoryTable.id,
      name: categoryTable.name,
      localizedNames: categoryTable.localizedNames,
      origin: categoryTable.origin,
    })
    .from(readingWorkCategoryTable)
    .innerJoin(categoryTable, eq(readingWorkCategoryTable.categoryId, categoryTable.id))
    .where(inArray(readingWorkCategoryTable.workId, workIds));
  const map = new Map<string, TaxonomyReference>();
  for (const row of rows) {
    if (!map.has(row.workId)) {
      map.set(row.workId, toTaxonomyReference(row));
    }
  }
  return map;
}

/** Current category reference (single-select) or null when unset. */
export async function loadCategoryForWork(workId: string): Promise<TaxonomyReference | null> {
  const [row] = await db
    .select({
      id: categoryTable.id,
      name: categoryTable.name,
      localizedNames: categoryTable.localizedNames,
      origin: categoryTable.origin,
    })
    .from(readingWorkCategoryTable)
    .innerJoin(categoryTable, eq(readingWorkCategoryTable.categoryId, categoryTable.id))
    .where(eq(readingWorkCategoryTable.workId, workId))
    .limit(1);
  return row ? toTaxonomyReference(row) : null;
}
