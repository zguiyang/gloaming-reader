import { randomUUID } from 'node:crypto';

import { and, asc, eq, ne, sql } from 'drizzle-orm';

import {
  discoverySource as discoverySourceTable,
  publicCategory as publicCategoryTable,
  publicCategoryAlias as publicCategoryAliasTable,
  publicCategoryLabel as publicCategoryLabelTable,
  sourceRecord as sourceRecordTable,
  sourceRecordPublicCategory as sourceRecordPublicCategoryTable,
} from '@gloaming/db/schema';
import type {
  PublicCategory,
  PublicCategoryProvenance,
  SourceRecordAuthor,
  SourceRecordAvailability,
  SourceRecordSourceMeta,
} from '@gloaming/shared/discovery';

import { buildPublicCategory, decideCategoryAssignment } from '@/domains/discovery/categories/policy';
import {
  categoryExists,
  countAssignmentsForRecord,
  deleteAssignment,
  getAssignmentRow,
  hasSuppression,
  listAllAliasRows,
  listAllLabelRows,
  listCategoryRows,
  lockSourceRecord,
  upsertAssignment,
} from '@/domains/discovery/categories/repository';
import { db } from '@/infra/db';

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

export type ApplyPublicCategoryAssignmentsOptions = {
  /**
   * Reconcile this record's AI-owned associations to the incoming set inside the
   * same locked transaction: AI rows this pass no longer proposes are deleted
   * before the incoming set is applied. Manual rows are never deleted, no
   * suppression is recorded (suppression only remembers explicit administrator
   * removals), and suppressed pairs are never restored. Pass `false` for a
   * review abstention, which must leave existing associations untouched.
   */
  reconcileStaleAi: boolean;
};

/**
 * Apply one classification pass for a pre-validated category set. The whole
 * operation — SourceRecord row lock, stale-AI reconciliation, insert decisions,
 * and the final read-back — runs in one transaction so it can never interleave
 * with a concurrent manual assignment edit. The shared assignment policy keeps
 * manual assignments, keeps explicit suppression, deduplicates, and enforces
 * the 0-3 limit. Returns the category ids the record actually carries after
 * this pass (manual and AI alike).
 */
export async function applyPublicCategoryAssignments(
  recordId: string,
  categoryIds: string[],
  options: ApplyPublicCategoryAssignmentsOptions,
): Promise<string[]> {
  return db.transaction(async (tx) => {
    if (!(await lockSourceRecord(tx, recordId))) return [];

    if (options.reconcileStaleAi) {
      const incoming = new Set(categoryIds);
      const aiRows = await tx
        .select({ categoryId: sourceRecordPublicCategoryTable.categoryId })
        .from(sourceRecordPublicCategoryTable)
        .where(
          and(
            eq(sourceRecordPublicCategoryTable.sourceRecordId, recordId),
            eq(sourceRecordPublicCategoryTable.source, 'ai'),
          ),
        );
      for (const row of aiRows) {
        if (!incoming.has(row.categoryId)) {
          await deleteAssignment(tx, recordId, row.categoryId);
        }
      }
    }

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
      }
    }

    const rows = await tx
      .select({ categoryId: sourceRecordPublicCategoryTable.categoryId })
      .from(sourceRecordPublicCategoryTable)
      .where(eq(sourceRecordPublicCategoryTable.sourceRecordId, recordId))
      .orderBy(asc(sourceRecordPublicCategoryTable.categoryId));
    return rows.map((row) => row.categoryId);
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
