import { randomUUID } from 'node:crypto';

import { and, asc, count, eq, inArray } from 'drizzle-orm';

import {
  discoverySource as discoverySourceTable,
  publicCategory as publicCategoryTable,
  publicCategoryAlias as publicCategoryAliasTable,
  publicCategoryLabel as publicCategoryLabelTable,
  sourceRecord as sourceRecordTable,
  sourceRecordPublicCategory as sourceRecordPublicCategoryTable,
  sourceRecordPublicCategorySuppression as sourceRecordPublicCategorySuppressionTable,
} from '@gloaming/db/schema';
import type { PublicCategoryProvenance, PublicCategorySummary } from '@gloaming/shared/discovery';
import { DISCOVERY_DEFAULT_LANGUAGE } from '@gloaming/shared/discovery';

import { buildPublicCategory, toPublicCategorySummary } from '@/domains/discovery/categories/policy';
import { publicDiscoverableRecordWhere } from '@/domains/discovery/read-model/visibility';
import { db } from '@/infra/db';

export type PublicCategoryRow = typeof publicCategoryTable.$inferSelect;
export type PublicCategoryLabelRow = typeof publicCategoryLabelTable.$inferSelect;
export type PublicCategoryAliasRow = typeof publicCategoryAliasTable.$inferSelect;
export type SourceRecordPublicCategoryRow = typeof sourceRecordPublicCategoryTable.$inferSelect;

/** Transaction handle for the assignment workflow; keeps writes serialized. */
export type CategoryTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** One SourceRecord assignment joined with the category's raw label rows. */
export type CategoryLabelSummaryRow = {
  recordId: string;
  categoryId: string;
  createdBy: PublicCategoryProvenance;
  sourceLocale: string | null;
  meaning: string | null;
  labelLocale: string;
  labelName: string;
  labelEditedBy: PublicCategoryProvenance;
};

export async function listCategoryRows(): Promise<PublicCategoryRow[]> {
  return db.select().from(publicCategoryTable).orderBy(asc(publicCategoryTable.id));
}

export async function getCategoryRow(categoryId: string): Promise<PublicCategoryRow | null> {
  const [row] = await db.select().from(publicCategoryTable).where(eq(publicCategoryTable.id, categoryId)).limit(1);
  return row ?? null;
}

export async function listAllLabelRows(): Promise<PublicCategoryLabelRow[]> {
  return db.select().from(publicCategoryLabelTable).orderBy(asc(publicCategoryLabelTable.locale));
}

export async function listLabelRowsByCategoryIds(categoryIds: string[]): Promise<PublicCategoryLabelRow[]> {
  if (categoryIds.length === 0) return [];
  return db
    .select()
    .from(publicCategoryLabelTable)
    .where(inArray(publicCategoryLabelTable.categoryId, categoryIds))
    .orderBy(asc(publicCategoryLabelTable.locale));
}

export async function listAllAliasRows(): Promise<PublicCategoryAliasRow[]> {
  return db.select().from(publicCategoryAliasTable).orderBy(asc(publicCategoryAliasTable.locale));
}

export async function listAliasRowsByCategoryIds(categoryIds: string[]): Promise<PublicCategoryAliasRow[]> {
  if (categoryIds.length === 0) return [];
  return db
    .select()
    .from(publicCategoryAliasTable)
    .where(inArray(publicCategoryAliasTable.categoryId, categoryIds))
    .orderBy(asc(publicCategoryAliasTable.locale));
}

/** Category id owning `(locale, normalized_name)`, or null when the label is free. */
export async function findCategoryIdByNormalizedLabel(locale: string, normalizedName: string): Promise<string | null> {
  const [row] = await db
    .select({ categoryId: publicCategoryLabelTable.categoryId })
    .from(publicCategoryLabelTable)
    .where(
      and(eq(publicCategoryLabelTable.locale, locale), eq(publicCategoryLabelTable.normalizedName, normalizedName)),
    )
    .limit(1);
  return row?.categoryId ?? null;
}

/** Total assigned SourceRecords per category, including records not publicly visible. */
export async function countAssignmentsByCategoryIds(categoryIds: string[]): Promise<Map<string, number>> {
  if (categoryIds.length === 0) return new Map();
  const rows = await db
    .select({ categoryId: sourceRecordPublicCategoryTable.categoryId, value: count() })
    .from(sourceRecordPublicCategoryTable)
    .where(inArray(sourceRecordPublicCategoryTable.categoryId, categoryIds))
    .groupBy(sourceRecordPublicCategoryTable.categoryId);
  return new Map(rows.map((row) => [row.categoryId, Number(row.value)]));
}

/**
 * Publicly discoverable SourceRecord count per category. Uses the same shared
 * visibility predicate as the Discover record list (available record on an
 * enabled source, in the requested Discover content language — defaulting to
 * the shared Discover language default), so a category count never exceeds
 * what the filtered record list can actually show for that language.
 */
export async function countPublicRecordsByCategoryIds(
  categoryIds: string[],
  language: string = DISCOVERY_DEFAULT_LANGUAGE,
): Promise<Map<string, number>> {
  if (categoryIds.length === 0) return new Map();
  const rows = await db
    .select({ categoryId: sourceRecordPublicCategoryTable.categoryId, value: count() })
    .from(sourceRecordPublicCategoryTable)
    .innerJoin(sourceRecordTable, eq(sourceRecordTable.id, sourceRecordPublicCategoryTable.sourceRecordId))
    .innerJoin(discoverySourceTable, eq(discoverySourceTable.id, sourceRecordTable.sourceId))
    .where(
      and(inArray(sourceRecordPublicCategoryTable.categoryId, categoryIds), publicDiscoverableRecordWhere(language)),
    )
    .groupBy(sourceRecordPublicCategoryTable.categoryId);
  return new Map(rows.map((row) => [row.categoryId, Number(row.value)]));
}

/**
 * Minimal public category summaries for SourceRecord list/detail responses.
 * Only `id` + locale-resolved `name` are built; retrieval/management fields stay
 * out of the public projection.
 */
export async function loadCategorySummariesByRecordIds(
  recordIds: string[],
  locale: string,
): Promise<Map<string, PublicCategorySummary[]>> {
  const summaries = new Map<string, PublicCategorySummary[]>();
  if (recordIds.length === 0) return summaries;

  const rows = await db
    .select({
      recordId: sourceRecordPublicCategoryTable.sourceRecordId,
      categoryId: publicCategoryTable.id,
      createdBy: publicCategoryTable.createdBy,
      sourceLocale: publicCategoryTable.sourceLocale,
      meaning: publicCategoryTable.meaning,
      labelLocale: publicCategoryLabelTable.locale,
      labelName: publicCategoryLabelTable.name,
      labelEditedBy: publicCategoryLabelTable.editedBy,
    })
    .from(sourceRecordPublicCategoryTable)
    .innerJoin(publicCategoryTable, eq(publicCategoryTable.id, sourceRecordPublicCategoryTable.categoryId))
    .innerJoin(publicCategoryLabelTable, eq(publicCategoryLabelTable.categoryId, publicCategoryTable.id))
    .where(inArray(sourceRecordPublicCategoryTable.sourceRecordId, recordIds))
    .orderBy(asc(publicCategoryLabelTable.locale));

  const grouped = new Map<string, CategoryLabelSummaryRow[]>();
  for (const row of rows) {
    const key = `${row.recordId}::${row.categoryId}`;
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }

  const seen = new Map<string, Set<string>>();
  for (const group of grouped.values()) {
    const first = group[0]!;
    const category = buildPublicCategory({
      id: first.categoryId,
      createdBy: first.createdBy,
      sourceLocale: first.sourceLocale,
      meaning: first.meaning,
      labels: group.map((row) => ({
        locale: row.labelLocale,
        name: row.labelName,
        editedBy: row.labelEditedBy,
      })),
      aliases: [],
    });
    const summary = toPublicCategorySummary(category, locale);
    if (summary === null) continue;
    const recordSummaryIds = seen.get(first.recordId) ?? new Set<string>();
    if (recordSummaryIds.has(first.categoryId)) continue;
    recordSummaryIds.add(first.categoryId);
    seen.set(first.recordId, recordSummaryIds);
    const list = summaries.get(first.recordId) ?? [];
    list.push(summary);
    summaries.set(first.recordId, list);
  }

  return summaries;
}

export async function insertCategoryWithLabel(input: {
  locale: string;
  name: string;
  normalizedName: string;
}): Promise<PublicCategoryRow> {
  return db.transaction(async (tx) => {
    const [category] = await tx
      .insert(publicCategoryTable)
      .values({ id: randomUUID(), createdBy: 'manual', sourceLocale: input.locale, meaning: null })
      .returning();
    await tx.insert(publicCategoryLabelTable).values({
      id: randomUUID(),
      categoryId: category!.id,
      locale: input.locale,
      name: input.name,
      normalizedName: input.normalizedName,
      editedBy: 'manual',
    });
    return category!;
  });
}

/**
 * Insert or replace one localized label. `edited_by = 'manual'` marks the label so
 * no automatic translation or AI completion may overwrite it later.
 */
export async function upsertManualCategoryLabel(input: {
  categoryId: string;
  locale: string;
  name: string;
  normalizedName: string;
}): Promise<void> {
  await db
    .insert(publicCategoryLabelTable)
    .values({
      id: randomUUID(),
      categoryId: input.categoryId,
      locale: input.locale,
      name: input.name,
      normalizedName: input.normalizedName,
      editedBy: 'manual',
    })
    .onConflictDoUpdate({
      target: [publicCategoryLabelTable.categoryId, publicCategoryLabelTable.locale],
      set: { name: input.name, normalizedName: input.normalizedName, editedBy: 'manual' },
    });
}

/** Locks the SourceRecord row so concurrent assignment requests serialize. */
export async function lockSourceRecord(tx: CategoryTx, sourceRecordId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: sourceRecordTable.id })
    .from(sourceRecordTable)
    .where(eq(sourceRecordTable.id, sourceRecordId))
    .for('update')
    .limit(1);
  return rows.length > 0;
}

/** Locks the category row so the delete guard and a concurrent assignment serialize. */
export async function lockCategoryRow(tx: CategoryTx, categoryId: string): Promise<PublicCategoryRow | null> {
  const [row] = await tx.select().from(publicCategoryTable).where(eq(publicCategoryTable.id, categoryId)).for('update');
  return row ?? null;
}

/** Current assignment count for one category, scoped to the caller's transaction. */
export async function countAssignmentsForCategory(tx: CategoryTx, categoryId: string): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(sourceRecordPublicCategoryTable)
    .where(eq(sourceRecordPublicCategoryTable.categoryId, categoryId));
  return Number(row?.value ?? 0);
}

/** Removes the category row; owned labels/aliases/suppressions go via ON DELETE CASCADE. */
export async function deleteCategoryRow(tx: CategoryTx, categoryId: string): Promise<number> {
  const result = await tx.delete(publicCategoryTable).where(eq(publicCategoryTable.id, categoryId));
  return result.rowCount ?? 0;
}

export async function categoryExists(tx: CategoryTx, categoryId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: publicCategoryTable.id })
    .from(publicCategoryTable)
    .where(eq(publicCategoryTable.id, categoryId))
    .limit(1);
  return Boolean(row);
}

export async function getAssignmentRow(
  tx: CategoryTx,
  sourceRecordId: string,
  categoryId: string,
): Promise<SourceRecordPublicCategoryRow | null> {
  const [row] = await tx
    .select()
    .from(sourceRecordPublicCategoryTable)
    .where(
      and(
        eq(sourceRecordPublicCategoryTable.sourceRecordId, sourceRecordId),
        eq(sourceRecordPublicCategoryTable.categoryId, categoryId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function countAssignmentsForRecord(tx: CategoryTx, sourceRecordId: string): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(sourceRecordPublicCategoryTable)
    .where(eq(sourceRecordPublicCategoryTable.sourceRecordId, sourceRecordId));
  return Number(row?.value ?? 0);
}

export async function hasSuppression(tx: CategoryTx, sourceRecordId: string, categoryId: string): Promise<boolean> {
  const [row] = await tx
    .select({ sourceRecordId: sourceRecordPublicCategorySuppressionTable.sourceRecordId })
    .from(sourceRecordPublicCategorySuppressionTable)
    .where(
      and(
        eq(sourceRecordPublicCategorySuppressionTable.sourceRecordId, sourceRecordId),
        eq(sourceRecordPublicCategorySuppressionTable.categoryId, categoryId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function clearSuppression(tx: CategoryTx, sourceRecordId: string, categoryId: string): Promise<void> {
  await tx
    .delete(sourceRecordPublicCategorySuppressionTable)
    .where(
      and(
        eq(sourceRecordPublicCategorySuppressionTable.sourceRecordId, sourceRecordId),
        eq(sourceRecordPublicCategorySuppressionTable.categoryId, categoryId),
      ),
    );
}

/** Records the exact removed pair so a normal AI retry cannot restore it. */
export async function insertSuppression(tx: CategoryTx, sourceRecordId: string, categoryId: string): Promise<void> {
  await tx
    .insert(sourceRecordPublicCategorySuppressionTable)
    .values({ sourceRecordId, categoryId })
    .onConflictDoUpdate({
      target: [
        sourceRecordPublicCategorySuppressionTable.sourceRecordId,
        sourceRecordPublicCategorySuppressionTable.categoryId,
      ],
      set: { removedAt: new Date() },
    });
}

export async function upsertAssignment(
  tx: CategoryTx,
  input: { sourceRecordId: string; categoryId: string; source: PublicCategoryProvenance },
): Promise<void> {
  await tx
    .insert(sourceRecordPublicCategoryTable)
    .values({
      id: randomUUID(),
      sourceRecordId: input.sourceRecordId,
      categoryId: input.categoryId,
      source: input.source,
    })
    .onConflictDoUpdate({
      target: [sourceRecordPublicCategoryTable.sourceRecordId, sourceRecordPublicCategoryTable.categoryId],
      set: { source: input.source },
    });
}

export async function deleteAssignment(tx: CategoryTx, sourceRecordId: string, categoryId: string): Promise<void> {
  await tx
    .delete(sourceRecordPublicCategoryTable)
    .where(
      and(
        eq(sourceRecordPublicCategoryTable.sourceRecordId, sourceRecordId),
        eq(sourceRecordPublicCategoryTable.categoryId, categoryId),
      ),
    );
}

/** Test/diagnostic helper: assignments for one record, without a transaction. */
export async function listAssignmentsForRecord(sourceRecordId: string): Promise<SourceRecordPublicCategoryRow[]> {
  return db
    .select()
    .from(sourceRecordPublicCategoryTable)
    .where(eq(sourceRecordPublicCategoryTable.sourceRecordId, sourceRecordId))
    .orderBy(asc(sourceRecordPublicCategoryTable.categoryId));
}
