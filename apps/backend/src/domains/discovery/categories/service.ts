import {
  canonicalizePublicCategoryName,
  type CategorySourceRecordListQuery,
  normalizePublicCategoryName,
  PUBLIC_CATEGORY_ASSIGNMENT_LIMIT,
  type PublicCategoryListData,
  type PublicCategoryListItem,
  type PublicCategoryManagementItem,
  type PublicCategoryProvenance,
  type SourceRecordListData,
} from '@gloaming/shared/discovery';

import {
  buildPublicCategory,
  decideCategoryAssignment,
  shouldSuppressOnRemoval,
  toPublicCategoryListItem,
  toPublicCategoryManagementItem,
} from '@/domains/discovery/categories/policy';
import {
  categoryExists,
  clearSuppression,
  countAssignmentsByCategoryIds,
  countAssignmentsForCategory,
  countAssignmentsForRecord,
  countPublicRecordsByCategoryIds,
  deleteAssignment,
  deleteCategoryRow,
  findCategoryIdByNormalizedLabel,
  getAssignmentRow,
  getCategoryRow,
  hasSuppression,
  insertCategoryWithLabel,
  insertSuppression,
  listAliasRowsByCategoryIds,
  listAllAliasRows,
  listAllLabelRows,
  listCategoryRows,
  listLabelRowsByCategoryIds,
  lockCategoryRow,
  lockSourceRecord,
  type PublicCategoryAliasRow,
  type PublicCategoryLabelRow,
  type PublicCategoryRow,
  upsertAssignment,
  upsertManualCategoryLabel,
} from '@/domains/discovery/categories/repository';
import { listCategorySourceRecords } from '@/domains/discovery/read-model';
import { db } from '@/infra/db';
import { HTTP_STATUS } from '@/shared/constants';
import { AppError, NotFoundError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

function categoryNameExists(): AppError {
  return new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.DISCOVERY.PUBLIC_CATEGORY_NAME_EXISTS);
}

function categoryLimitExceeded(): AppError {
  return new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.DISCOVERY.PUBLIC_CATEGORY_LIMIT_EXCEEDED, {
    limit: PUBLIC_CATEGORY_ASSIGNMENT_LIMIT,
  });
}

function categoryHasAssignments(count: number): AppError {
  return new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.DISCOVERY.PUBLIC_CATEGORY_HAS_ASSIGNMENTS, { count });
}

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

function toPublicCategory(row: PublicCategoryRow, labels: PublicCategoryLabelRow[], aliases: PublicCategoryAliasRow[]) {
  return buildPublicCategory({
    id: row.id,
    createdBy: row.createdBy,
    sourceLocale: row.sourceLocale,
    meaning: row.meaning,
    labels: labels.map((label) => ({
      locale: label.locale,
      name: label.name,
      editedBy: label.editedBy,
    })),
    aliases: aliases.map((alias) => ({
      locale: alias.locale,
      alias: alias.alias,
      editedBy: alias.editedBy,
    })),
  });
}

function groupByCategoryId<T extends { categoryId: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const group = grouped.get(row.categoryId) ?? [];
    group.push(row);
    grouped.set(row.categoryId, group);
  }
  return grouped;
}

/**
 * Public Discover category list: stable id + locale-resolved display name + the
 * count of publicly discoverable records. Internal management fields are never
 * projected here.
 */
export async function listPublicCategories(locale: string): Promise<PublicCategoryListData> {
  const categories = await listCategoryRows();
  if (categories.length === 0) return { items: [] };

  const [labels, counts] = await Promise.all([
    listAllLabelRows(),
    countPublicRecordsByCategoryIds(categories.map((category) => category.id)),
  ]);
  const labelsByCategory = groupByCategoryId(labels);

  const items: PublicCategoryListItem[] = [];
  for (const category of categories) {
    const item = toPublicCategoryListItem(
      toPublicCategory(category, labelsByCategory.get(category.id) ?? [], []),
      locale,
      counts.get(category.id) ?? 0,
    );
    if (item) items.push(item);
  }
  items.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { items };
}

/** Public category detail. A label-less category cannot be rendered, so it 404s. */
export async function getPublicCategory(categoryId: string, locale: string): Promise<PublicCategoryListItem> {
  const row = await getCategoryRow(categoryId);
  if (!row) throw new NotFoundError(ERROR_CODES.NOT_FOUND.PUBLIC_CATEGORY);

  const [labels, counts] = await Promise.all([
    listLabelRowsByCategoryIds([categoryId]),
    countPublicRecordsByCategoryIds([categoryId]),
  ]);
  const item = toPublicCategoryListItem(toPublicCategory(row, labels, []), locale, counts.get(categoryId) ?? 0);
  if (!item) throw new NotFoundError(ERROR_CODES.NOT_FOUND.PUBLIC_CATEGORY);
  return item;
}

async function loadManagedCategory(categoryId: string): Promise<PublicCategoryManagementItem> {
  const row = await getCategoryRow(categoryId);
  if (!row) throw new NotFoundError(ERROR_CODES.NOT_FOUND.PUBLIC_CATEGORY);

  const [labels, aliases, counts] = await Promise.all([
    listLabelRowsByCategoryIds([categoryId]),
    listAliasRowsByCategoryIds([categoryId]),
    countAssignmentsByCategoryIds([categoryId]),
  ]);
  return toPublicCategoryManagementItem(toPublicCategory(row, labels, aliases), counts.get(categoryId) ?? 0);
}

/** Admin list: full category contract plus total assigned record counts. */
export async function listManagedCategories(): Promise<PublicCategoryManagementItem[]> {
  const categories = await listCategoryRows();
  if (categories.length === 0) return [];

  const [labels, aliases, counts] = await Promise.all([
    listAllLabelRows(),
    listAllAliasRows(),
    countAssignmentsByCategoryIds(categories.map((category) => category.id)),
  ]);
  const labelsByCategory = groupByCategoryId(labels);
  const aliasesByCategory = groupByCategoryId(aliases);

  return categories.map((category) =>
    toPublicCategoryManagementItem(
      toPublicCategory(category, labelsByCategory.get(category.id) ?? [], aliasesByCategory.get(category.id) ?? []),
      counts.get(category.id) ?? 0,
    ),
  );
}

/**
 * Admin paginated view of one category's assignments. Returns 404 when the
 * category is unknown; the page itself is not filtered by public visibility.
 */
export async function listManagedCategorySourceRecords(
  categoryId: string,
  query: CategorySourceRecordListQuery,
  locale: string,
): Promise<SourceRecordListData> {
  const row = await getCategoryRow(categoryId);
  if (!row) throw new NotFoundError(ERROR_CODES.NOT_FOUND.PUBLIC_CATEGORY);
  return listCategorySourceRecords(categoryId, query, { locale });
}

/**
 * Manually create a category, or reuse the existing category that already owns
 * the same normalized label for that locale. Reuse keeps the stable category id
 * and its manually edited labels instead of creating a duplicate concept.
 */
export async function createManagedCategory(input: {
  name: string;
  locale: string;
}): Promise<PublicCategoryManagementItem> {
  const name = canonicalizePublicCategoryName(input.name);
  const normalizedName = normalizePublicCategoryName(name);

  const existingId = await findCategoryIdByNormalizedLabel(input.locale, normalizedName);
  if (existingId) return loadManagedCategory(existingId);

  try {
    const row = await insertCategoryWithLabel({ locale: input.locale, name, normalizedName });
    return loadManagedCategory(row.id);
  } catch (error) {
    if (isUniqueViolation(error)) {
      const racedId = await findCategoryIdByNormalizedLabel(input.locale, normalizedName);
      if (racedId) return loadManagedCategory(racedId);
      throw categoryNameExists();
    }
    throw error;
  }
}

/**
 * Edit (or add) one localized label. The normalized name is unique per locale, so
 * a collision with another category is rejected; within the same category a
 * manual edit is idempotent and marked `editedBy = 'manual'` to protect it from
 * later automatic overwrite.
 */
export async function updateManagedCategoryLabel(
  categoryId: string,
  input: { name: string; locale: string },
): Promise<PublicCategoryManagementItem> {
  const name = canonicalizePublicCategoryName(input.name);
  const normalizedName = normalizePublicCategoryName(name);

  const row = await getCategoryRow(categoryId);
  if (!row) throw new NotFoundError(ERROR_CODES.NOT_FOUND.PUBLIC_CATEGORY);

  const ownerId = await findCategoryIdByNormalizedLabel(input.locale, normalizedName);
  if (ownerId && ownerId !== categoryId) throw categoryNameExists();

  try {
    await upsertManualCategoryLabel({ categoryId, locale: input.locale, name, normalizedName });
  } catch (error) {
    if (isUniqueViolation(error)) throw categoryNameExists();
    throw error;
  }
  return loadManagedCategory(categoryId);
}

/**
 * Permanently delete a category that no SourceRecord still references. The row is
 * locked `FOR UPDATE` inside the transaction: a concurrent assignment insert first
 * takes a `FOR KEY SHARE` lock on this parent row, which conflicts with `FOR UPDATE`,
 * so a new assignment cannot slip past the zero-assignment check between the count
 * and the delete. Labels, aliases, and suppressions are owned by the category and
 * are removed by the existing `ON DELETE CASCADE` foreign keys; a category with any
 * remaining assignment is rejected with 409 instead of silently dropping it.
 */
export async function deleteManagedCategory(categoryId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await lockCategoryRow(tx, categoryId);
    if (!row) throw new NotFoundError(ERROR_CODES.NOT_FOUND.PUBLIC_CATEGORY);

    const assignmentCount = await countAssignmentsForCategory(tx, categoryId);
    if (assignmentCount > 0) throw categoryHasAssignments(assignmentCount);

    await deleteCategoryRow(tx, categoryId);
  });
}

/**
 * Assign a category to a SourceRecord. The SourceRecord row is locked so
 * concurrent requests serialize: the 0–3 cap cannot be exceeded, repeats are
 * idempotent, a manual assignment promotes/keeps over an AI one, and an explicit
 * manual assignment clears any prior suppression for that exact pair.
 */
export async function assignCategoryToSourceRecord(
  sourceRecordId: string,
  categoryId: string,
  incomingSource: PublicCategoryProvenance,
): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await lockSourceRecord(tx, sourceRecordId))) {
      throw new NotFoundError(ERROR_CODES.NOT_FOUND.SOURCE_RECORD);
    }
    if (!(await categoryExists(tx, categoryId))) {
      throw new NotFoundError(ERROR_CODES.NOT_FOUND.PUBLIC_CATEGORY);
    }

    if (incomingSource === 'manual') {
      await clearSuppression(tx, sourceRecordId, categoryId);
    }

    const existing = await getAssignmentRow(tx, sourceRecordId, categoryId);
    const assignmentCount = await countAssignmentsForRecord(tx, sourceRecordId);
    const suppressed = incomingSource === 'ai' ? await hasSuppression(tx, sourceRecordId, categoryId) : false;

    const decision = decideCategoryAssignment({
      incomingSource,
      existingSource: existing?.source ?? null,
      assignmentCount,
      suppressed,
    });

    if (decision === 'limit') throw categoryLimitExceeded();
    if (decision === 'insert' || decision === 'promote') {
      await upsertAssignment(tx, { sourceRecordId, categoryId, source: incomingSource });
    }
  });
}

/**
 * Remove a category from a SourceRecord. An explicit removal of an existing
 * assignment records exact-pair suppression regardless of the removed row's
 * provenance, so a normal AI retry cannot restore it; removing a pair that was
 * never assigned is an idempotent no-op. A manual re-add clears the suppression.
 */
export async function unassignCategoryFromSourceRecord(sourceRecordId: string, categoryId: string): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await lockSourceRecord(tx, sourceRecordId))) {
      throw new NotFoundError(ERROR_CODES.NOT_FOUND.SOURCE_RECORD);
    }

    const existing = await getAssignmentRow(tx, sourceRecordId, categoryId);
    if (shouldSuppressOnRemoval(existing?.source ?? null)) {
      await insertSuppression(tx, sourceRecordId, categoryId);
    }
    await deleteAssignment(tx, sourceRecordId, categoryId);
  });
}
