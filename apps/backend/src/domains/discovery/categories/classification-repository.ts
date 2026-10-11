import { randomUUID } from 'node:crypto';

import { and, eq, ne, sql } from 'drizzle-orm';

import {
  discoverySource as discoverySourceTable,
  publicCategory as publicCategoryTable,
  publicCategoryAlias as publicCategoryAliasTable,
  publicCategoryLabel as publicCategoryLabelTable,
  publicClassificationBudget as publicClassificationBudgetTable,
  sourceRecord as sourceRecordTable,
} from '@gloaming/db/schema';
import type {
  PublicCategory,
  PublicCategoryProvenance,
  SourceRecordAuthor,
  SourceRecordAvailability,
  SourceRecordSourceMeta,
} from '@gloaming/shared/discovery';

import { PUBLIC_CLASSIFICATION_DAILY_RESERVATION_LIMIT } from '@/domains/discovery/categories/classification-contract';
import { buildPublicCategory, decideCategoryAssignment } from '@/domains/discovery/categories/policy';
import {
  categoryExists,
  countAssignmentsForRecord,
  getAssignmentRow,
  hasSuppression,
  listAllAliasRows,
  listAllLabelRows,
  listCategoryRows,
  lockSourceRecord,
  upsertAssignment,
} from '@/domains/discovery/categories/repository';
import { db } from '@/infra/db';

/** Fixed singleton row id for the instance-wide daily reservation budget. */
export const PUBLIC_CLASSIFICATION_BUDGET_ID = 'instance';

export type ClassifiableSourceRecordRow = {
  id: string;
  title: string;
  authors: SourceRecordAuthor[];
  languages: string[];
  description: string | null;
  sourceMeta: SourceRecordSourceMeta;
  availability: SourceRecordAvailability;
  sourceEnabled: boolean;
};

export type PublicCategoryTranslationSource = {
  id: string;
  meaning: string | null;
  sourceLocale: string | null;
  labels: Array<{ locale: string; name: string; editedBy: PublicCategoryProvenance }>;
  aliases: Array<{ locale: string; alias: string }>;
};

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === '23505') return true;
  return (
    'cause' in error &&
    typeof error.cause === 'object' &&
    error.cause !== null &&
    'code' in error.cause &&
    error.cause.code === '23505'
  );
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Reserve one instance-wide AI call slot (classification or label translation)
 * for the current UTC day. Returns the reservation date, or null when the fixed
 * daily cap is exhausted. The singleton row is locked so concurrent callers
 * serialize and can never exceed the cap.
 */
export async function reservePublicClassificationCall(): Promise<string | null> {
  const today = utcDay();
  return db.transaction(async (tx) => {
    await tx
      .insert(publicClassificationBudgetTable)
      .values({ id: PUBLIC_CLASSIFICATION_BUDGET_ID, quotaDate: today, quotaUsed: 0, quotaReserved: 0 })
      .onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(publicClassificationBudgetTable)
      .where(eq(publicClassificationBudgetTable.id, PUBLIC_CLASSIFICATION_BUDGET_ID))
      .for('update')
      .limit(1);
    if (!row) return null;

    const used = row.quotaDate === today ? row.quotaUsed : 0;
    const reserved = row.quotaDate === today ? row.quotaReserved : 0;
    if (used + reserved >= PUBLIC_CLASSIFICATION_DAILY_RESERVATION_LIMIT) {
      if (row.quotaDate !== today) {
        await tx
          .update(publicClassificationBudgetTable)
          .set({ quotaDate: today, quotaUsed: 0, quotaReserved: 0 })
          .where(eq(publicClassificationBudgetTable.id, PUBLIC_CLASSIFICATION_BUDGET_ID));
      }
      return null;
    }

    await tx
      .update(publicClassificationBudgetTable)
      .set({ quotaDate: today, quotaUsed: used, quotaReserved: reserved + 1 })
      .where(eq(publicClassificationBudgetTable.id, PUBLIC_CLASSIFICATION_BUDGET_ID));
    return today;
  });
}

/** Settle a reservation as one consumed call. A failed attempt still counts. */
export async function settlePublicClassificationCall(reservationDate: string): Promise<void> {
  await db
    .update(publicClassificationBudgetTable)
    .set({
      quotaReserved: sql`GREATEST(${publicClassificationBudgetTable.quotaReserved} - 1, 0)`,
      quotaUsed: sql`${publicClassificationBudgetTable.quotaUsed} + 1`,
    })
    .where(
      and(
        eq(publicClassificationBudgetTable.id, PUBLIC_CLASSIFICATION_BUDGET_ID),
        eq(publicClassificationBudgetTable.quotaDate, reservationDate),
      ),
    );
}

/** Bounded source-record evidence plus source visibility, for eligibility checks. */
export async function loadClassifiableSourceRecord(
  sourceRecordId: string,
): Promise<ClassifiableSourceRecordRow | null> {
  const rows = await db
    .select({
      id: sourceRecordTable.id,
      title: sourceRecordTable.title,
      authors: sourceRecordTable.authors,
      languages: sourceRecordTable.languages,
      description: sourceRecordTable.description,
      sourceMeta: sourceRecordTable.sourceMeta,
      availability: sourceRecordTable.availability,
      sourceEnabled: discoverySourceTable.enabled,
    })
    .from(sourceRecordTable)
    .innerJoin(discoverySourceTable, eq(discoverySourceTable.id, sourceRecordTable.sourceId))
    .where(eq(sourceRecordTable.id, sourceRecordId))
    .limit(1);
  return rows[0] ?? null;
}

/** Full public category vocabulary with stable id, localized names, aliases, and meaning. */
export async function listPublicCategoryCandidates(): Promise<PublicCategory[]> {
  const categories = await listCategoryRows();
  if (categories.length === 0) return [];
  const [labels, aliases] = await Promise.all([listAllLabelRows(), listAllAliasRows()]);
  const labelsByCategory = new Map<string, typeof labels>();
  for (const label of labels) {
    const group = labelsByCategory.get(label.categoryId) ?? [];
    group.push(label);
    labelsByCategory.set(label.categoryId, group);
  }
  const aliasesByCategory = new Map<string, typeof aliases>();
  for (const alias of aliases) {
    const group = aliasesByCategory.get(alias.categoryId) ?? [];
    group.push(alias);
    aliasesByCategory.set(alias.categoryId, group);
  }
  return categories.map((category) =>
    buildPublicCategory({
      id: category.id,
      createdBy: category.createdBy,
      sourceLocale: category.sourceLocale,
      meaning: category.meaning,
      labels: (labelsByCategory.get(category.id) ?? []).map((label) => ({
        locale: label.locale,
        name: label.name,
        editedBy: label.editedBy,
      })),
      aliases: (aliasesByCategory.get(category.id) ?? []).map((alias) => ({
        locale: alias.locale,
        alias: alias.alias,
        editedBy: alias.editedBy,
      })),
    }),
  );
}

/**
 * Insert one AI-created category and its source-locale label. If the normalized
 * name already belongs to another category in that locale, the empty category is
 * rolled back and the existing stable id is returned, so an exact name collision
 * safely reuses identity instead of creating a duplicate.
 */
export async function insertAiCategoryWithLabel(input: {
  locale: string;
  name: string;
  normalizedName: string;
  meaning: string;
}): Promise<{ id: string; created: boolean }> {
  return db.transaction(async (tx) => {
    const [category] = await tx
      .insert(publicCategoryTable)
      .values({ id: randomUUID(), createdBy: 'ai', sourceLocale: input.locale, meaning: input.meaning })
      .returning({ id: publicCategoryTable.id });
    const [label] = await tx
      .insert(publicCategoryLabelTable)
      .values({
        id: randomUUID(),
        categoryId: category!.id,
        locale: input.locale,
        name: input.name,
        normalizedName: input.normalizedName,
        editedBy: 'ai',
      })
      .onConflictDoNothing({ target: [publicCategoryLabelTable.locale, publicCategoryLabelTable.normalizedName] })
      .returning({ id: publicCategoryLabelTable.id });
    if (label) return { id: category!.id, created: true };

    await tx.delete(publicCategoryTable).where(eq(publicCategoryTable.id, category!.id));
    const [owner] = await tx
      .select({ categoryId: publicCategoryLabelTable.categoryId })
      .from(publicCategoryLabelTable)
      .where(
        and(
          eq(publicCategoryLabelTable.locale, input.locale),
          eq(publicCategoryLabelTable.normalizedName, input.normalizedName),
        ),
      )
      .limit(1);
    if (!owner) throw new Error('Failed to resolve a public category name collision');
    return { id: owner.categoryId, created: false };
  });
}

/**
 * Apply AI assignments for a pre-validated category set. The SourceRecord row is
 * locked, and the shared assignment policy keeps manual assignments, keeps
 * explicit suppression, deduplicates, and enforces the 0-3 limit. Returns the
 * effective category ids for the record (already-present pairs are idempotent).
 */
export async function applyPublicCategoryAssignments(recordId: string, categoryIds: string[]): Promise<string[]> {
  if (categoryIds.length === 0) return [];
  return db.transaction(async (tx) => {
    if (!(await lockSourceRecord(tx, recordId))) return [];
    const effective: string[] = [];
    for (const categoryId of categoryIds) {
      if (!(await categoryExists(tx, categoryId))) continue;
      const existing = await getAssignmentRow(tx, recordId, categoryId);
      const assignmentCount = await countAssignmentsForRecord(tx, recordId);
      const suppressed = await hasSuppression(tx, recordId, categoryId);
      const decision = decideCategoryAssignment({
        incomingSource: 'ai',
        existingSource: existing?.source ?? null,
        assignmentCount,
        suppressed,
      });
      if (decision === 'insert') {
        await upsertAssignment(tx, { sourceRecordId: recordId, categoryId, source: 'ai' });
        effective.push(categoryId);
      } else if (decision === 'noop' || decision === 'keep') {
        effective.push(categoryId);
      }
    }
    return effective;
  });
}

/** Category translation inputs: meaning, existing labels, and aliases. */
export async function loadPublicCategoryTranslationSource(
  categoryId: string,
): Promise<PublicCategoryTranslationSource | null> {
  const [category] = await db
    .select({
      id: publicCategoryTable.id,
      meaning: publicCategoryTable.meaning,
      sourceLocale: publicCategoryTable.sourceLocale,
    })
    .from(publicCategoryTable)
    .where(eq(publicCategoryTable.id, categoryId))
    .limit(1);
  if (!category) return null;
  const [labels, aliases] = await Promise.all([
    db
      .select({
        locale: publicCategoryLabelTable.locale,
        name: publicCategoryLabelTable.name,
        editedBy: publicCategoryLabelTable.editedBy,
      })
      .from(publicCategoryLabelTable)
      .where(eq(publicCategoryLabelTable.categoryId, categoryId)),
    db
      .select({ locale: publicCategoryAliasTable.locale, alias: publicCategoryAliasTable.alias })
      .from(publicCategoryAliasTable)
      .where(eq(publicCategoryAliasTable.categoryId, categoryId)),
  ]);
  return { ...category, labels, aliases };
}

/** Normalized label names owned by every other category, grouped by locale. */
export async function listOtherLabelNormalizedNamesByLocale(categoryId: string): Promise<Map<string, Set<string>>> {
  const rows = await db
    .select({ locale: publicCategoryLabelTable.locale, normalizedName: publicCategoryLabelTable.normalizedName })
    .from(publicCategoryLabelTable)
    .where(ne(publicCategoryLabelTable.categoryId, categoryId));
  const grouped = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = grouped.get(row.locale) ?? new Set<string>();
    set.add(row.normalizedName);
    grouped.set(row.locale, set);
  }
  return grouped;
}

/**
 * Upsert one AI-generated label. A label with `edited_by = 'manual'` is never
 * overwritten (existing row or a conflict during the write). A name that another
 * category already owns in the same locale is skipped instead of colliding.
 */
export async function upsertAiCategoryLabel(input: {
  categoryId: string;
  locale: string;
  name: string;
  normalizedName: string;
}): Promise<boolean> {
  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ editedBy: publicCategoryLabelTable.editedBy })
        .from(publicCategoryLabelTable)
        .where(
          and(
            eq(publicCategoryLabelTable.categoryId, input.categoryId),
            eq(publicCategoryLabelTable.locale, input.locale),
          ),
        )
        .limit(1);
      if (existing?.editedBy === 'manual') return false;

      const [row] = await tx
        .insert(publicCategoryLabelTable)
        .values({
          id: randomUUID(),
          categoryId: input.categoryId,
          locale: input.locale,
          name: input.name,
          normalizedName: input.normalizedName,
          editedBy: 'ai',
        })
        .onConflictDoUpdate({
          target: [publicCategoryLabelTable.categoryId, publicCategoryLabelTable.locale],
          set: { name: input.name, normalizedName: input.normalizedName, editedBy: 'ai' },
          setWhere: sql`${publicCategoryLabelTable.editedBy} <> 'manual'`,
        })
        .returning({ id: publicCategoryLabelTable.id });
      return Boolean(row);
    });
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}
