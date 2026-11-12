import { SUPPORTED_LOCALES } from '@gloaming/i18n';
import {
  canonicalizePublicCategoryName,
  type CategorySourceRecordListQuery,
  DISCOVERY_DEFAULT_LANGUAGE,
  normalizePublicCategoryName,
  type PublicCategoryListData,
  type PublicCategoryListItem,
  type PublicCategoryManagementItem,
  type PublicCategoryProvenance,
  type SourceRecordListData,
} from '@gloaming/shared/discovery';

import { translateMissingPublicCategoryLabels } from '@/server/domains/discovery/categories/classification';
import type { PublicClassificationDeferredReason } from '@/server/domains/discovery/categories/classification-contract';
import {
  buildPublicCategory,
  decideCategoryAssignment,
  shouldSuppressOnRemoval,
  toPublicCategoryListItem,
  toPublicCategoryManagementItem,
} from '@/server/domains/discovery/categories/policy';
import {
  categoryExists,
  clearSuppression,
  countAssignmentsByCategoryIds,
  countAssignmentsForCategory,
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
} from '@/server/domains/discovery/categories/repository';
import { detachCategoryShelfLinks } from '@/server/domains/discovery/categories/shelf-terms-admin';
import { listCategorySourceRecords } from '@/server/domains/discovery/read-model';
import { db } from '@/server/infra/db';
import { HTTP_STATUS } from '@/server/shared/constants';
import { AppError, NotFoundError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';

function categoryNameExists(): AppError {
  return new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.DISCOVERY.PUBLIC_CATEGORY_NAME_EXISTS);
}

async function ensureFallbackLocaleLabels(
  categoryId: string,
  primaryLocale: string,
  primaryName: string,
): Promise<void> {
  const primary = canonicalizePublicCategoryName(primaryName);
  const fallbackLocales = SUPPORTED_LOCALES.filter((locale) => locale !== primaryLocale);
  const englishName =
    primaryLocale === 'en-US'
      ? primary
      : (await listLabelRowsByCategoryIds([categoryId])).find((row) => row.locale === 'en-US')?.name;
  const fallback = englishName ? canonicalizePublicCategoryName(englishName) : primary;
  for (const locale of fallbackLocales) {
    const ownerId = await findCategoryIdByNormalizedLabel(locale, normalizePublicCategoryName(fallback));
    if (ownerId && ownerId !== categoryId) continue;
    const existing = await listLabelRowsByCategoryIds([categoryId]);
    if (existing.some((row) => row.locale === locale)) continue;
    await upsertManualCategoryLabel({
      categoryId,
      locale,
      name: fallback,
      normalizedName: normalizePublicCategoryName(fallback),
    });
  }
}

/**
 * Admin-facing error contract for a deferred translation pass: the instance
 * lock is held by another classification/translation run (409, retry shortly),
 * while a missing provider or an exhausted transient retry is a 503.
 */
function translationDeferredError(reason: PublicClassificationDeferredReason): AppError {
  if (reason === 'busy') {
    return new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.DISCOVERY.PUBLIC_CATEGORY_TRANSLATION_BUSY);
  }
  return new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.AI.UNAVAILABLE);
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
 *
 * `language` is the Discover content language: it scopes the counts with the
 * exact predicate the record list uses, so a category count never disagrees
 * with `GET /api/discover/records` for the same language. It defaults to the
 * shared Discover language default.
 */
export async function listPublicCategories(
  locale: string,
  language: string = DISCOVERY_DEFAULT_LANGUAGE,
): Promise<PublicCategoryListData> {
  const categories = await listCategoryRows();
  if (categories.length === 0) return { items: [] };

  const [labels, counts] = await Promise.all([
    listAllLabelRows(),
    countPublicRecordsByCategoryIds(
      categories.map((category) => category.id),
      language,
    ),
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

/**
 * Public category detail. A label-less category cannot be rendered, so it 404s.
 * `language` scopes `recordCount` with the same predicate as the list.
 */
export async function getPublicCategory(
  categoryId: string,
  locale: string,
  language: string = DISCOVERY_DEFAULT_LANGUAGE,
): Promise<PublicCategoryListItem> {
  const row = await getCategoryRow(categoryId);
  if (!row) throw new NotFoundError(ERROR_CODES.NOT_FOUND.PUBLIC_CATEGORY);

  const [labels, counts] = await Promise.all([
    listLabelRowsByCategoryIds([categoryId]),
    countPublicRecordsByCategoryIds([categoryId], language),
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
    await ensureFallbackLocaleLabels(row.id, input.locale, name);
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
    await ensureFallbackLocaleLabels(categoryId, input.locale, name);
  } catch (error) {
    if (isUniqueViolation(error)) throw categoryNameExists();
    throw error;
  }
  return loadManagedCategory(categoryId);
}

/**
 * Admin-triggered completion of a category's missing localized labels (PC-05).
 *
 * Calls the existing instance-only translation operation exactly once per
 * explicit click — it never runs automatically for the whole list and it never
 * touches an already-persisted locale, so manually edited labels are preserved
 * by the same `edited_by = 'manual'` guard the translator already applies.
 * Returns the locales actually written this pass; an empty array is the
 * no-op result when nothing is missing. A missing category is 404 and a
 * deferred pass surfaces through the standard admin error contract.
 */
export async function completeManagedCategoryTranslations(
  categoryId: string,
): Promise<{ translatedLocales: string[] }> {
  const result = await translateMissingPublicCategoryLabels(categoryId);
  switch (result.status) {
    case 'completed':
      return { translatedLocales: result.translatedLocales };
    case 'skipped':
      if (result.reason === 'category_not_found') {
        throw new NotFoundError(ERROR_CODES.NOT_FOUND.PUBLIC_CATEGORY);
      }
      return { translatedLocales: [] };
    case 'deferred':
      throw translationDeferredError(result.reason);
  }
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
    if (assignmentCount > 0) {
      throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.DISCOVERY.PUBLIC_CATEGORY_HAS_ASSIGNMENTS, {
        count: assignmentCount,
      });
    }

    // Shelf mapping links use ON DELETE RESTRICT; clear them only after the
    // assignment guard so we never force-delete a still-assigned category.
    await detachCategoryShelfLinks(tx, categoryId);
    await deleteCategoryRow(tx, categoryId);
  });
}

/**
 * Assign a category to a SourceRecord. The SourceRecord row is locked so
 * concurrent requests serialize, repeats are
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
    const suppressed = incomingSource === 'ai' ? await hasSuppression(tx, sourceRecordId, categoryId) : false;

    const decision = decideCategoryAssignment({
      incomingSource,
      existingSource: existing?.source ?? null,
      suppressed,
    });

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
