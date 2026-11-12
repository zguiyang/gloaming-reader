import { randomUUID } from 'node:crypto';

import { and, count, eq, inArray, sql } from 'drizzle-orm';

import {
  discoverySource,
  sourceCategoryMapping,
  sourceCategoryMappingCategory,
  sourceRecord,
  sourceRecordPublicCategory,
} from '@/server/db/schema';
import type { GutenbergShelfTermListData } from '@/shared/discovery';

import { getCategoryRow } from '@/server/domains/discovery/categories/repository';
import {
  GUTENBERG_CATEGORY_BOOKSHELF_PREFIX,
  isGutenbergCategoryBookshelf,
  normalizeSourceCategory,
  reconcileSourceCategoryAssignments,
} from '@/server/domains/discovery/categories/source-category-mapping';
import { PROJECT_GUTENBERG_SOURCE_KEY } from '@/server/domains/discovery/gutenberg/constants';
import { db } from '@/server/infra/db';
import { HTTP_STATUS } from '@/server/shared/constants';
import { AppError, NotFoundError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';

type ShelfTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function displayBookshelfName(sourceValue: string): string {
  return sourceValue.startsWith(GUTENBERG_CATEGORY_BOOKSHELF_PREFIX)
    ? sourceValue.slice(GUTENBERG_CATEGORY_BOOKSHELF_PREFIX.length).trim()
    : sourceValue.trim();
}

async function resolveProjectGutenbergSourceId(): Promise<string> {
  const [row] = await db
    .select({ id: discoverySource.id })
    .from(discoverySource)
    .where(eq(discoverySource.sourceKey, PROJECT_GUTENBERG_SOURCE_KEY))
    .limit(1);
  if (!row) throw new Error('Project Gutenberg discovery source is not configured');
  return row.id;
}

/** Admin list of Gutenberg Category: shelves with assignment and record counts. */
export async function listGutenbergCategoryShelfTerms(): Promise<GutenbergShelfTermListData> {
  const sourceId = await resolveProjectGutenbergSourceId();
  const mappings = await db
    .select()
    .from(sourceCategoryMapping)
    .where(
      and(
        eq(sourceCategoryMapping.sourceId, sourceId),
        sql`${sourceCategoryMapping.sourceValue} like ${GUTENBERG_CATEGORY_BOOKSHELF_PREFIX + '%'}`,
      ),
    )
    .orderBy(sourceCategoryMapping.sourceValue);
  if (mappings.length === 0) return { items: [] };

  const mappingIds = mappings.map((row) => row.id);
  const links = await db
    .select()
    .from(sourceCategoryMappingCategory)
    .where(inArray(sourceCategoryMappingCategory.mappingId, mappingIds));
  const categoryByMapping = new Map(links.map((row) => [row.mappingId, row.categoryId]));

  const items = await Promise.all(
    mappings.map(async (mapping) => {
      const [countRow] = await db
        .select({ value: count() })
        .from(sourceRecord)
        .where(
          and(
            eq(sourceRecord.sourceId, sourceId),
            sql`coalesce(${sourceRecord.sourceMeta}->'bookshelves', '[]'::jsonb) ? ${mapping.sourceValue}`,
          ),
        );
      return {
        mappingId: mapping.id,
        sourceValue: mapping.sourceValue,
        displayName: displayBookshelfName(mapping.sourceValue),
        categoryId: categoryByMapping.get(mapping.id) ?? null,
        recordCount: Number(countRow?.value ?? 0),
      };
    }),
  );
  return { items };
}

async function findRecordIdsForMappings(tx: ShelfTx, sourceId: string, sourceValues: string[]): Promise<string[]> {
  if (sourceValues.length === 0) return [];
  const rows = await tx
    .select({ id: sourceRecord.id, sourceMeta: sourceRecord.sourceMeta })
    .from(sourceRecord)
    .where(eq(sourceRecord.sourceId, sourceId));
  const values = new Set(sourceValues);
  return rows
    .filter((row) => (row.sourceMeta.bookshelves ?? []).some((shelf) => values.has(shelf)))
    .map((row) => row.id);
}

/** Replace the Category: shelves linked to one public category and recompute affected records. */
export async function saveCategoryShelfTerms(categoryId: string, mappingIds: string[]): Promise<void> {
  const uniqueIds = [...new Set(mappingIds)];
  if (!(await getCategoryRow(categoryId))) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.PUBLIC_CATEGORY);
  }
  const sourceId = await resolveProjectGutenbergSourceId();

  await db.transaction(async (tx) => {
    const incoming =
      uniqueIds.length > 0
        ? await tx
            .select()
            .from(sourceCategoryMapping)
            .where(
              and(
                eq(sourceCategoryMapping.sourceId, sourceId),
                inArray(sourceCategoryMapping.id, uniqueIds),
                sql`${sourceCategoryMapping.sourceValue} like ${GUTENBERG_CATEGORY_BOOKSHELF_PREFIX + '%'}`,
              ),
            )
        : [];
    if (incoming.length !== uniqueIds.length) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_INVALID_INPUT);
    }

    const previouslyLinked = await tx
      .select({ mappingId: sourceCategoryMappingCategory.mappingId })
      .from(sourceCategoryMappingCategory)
      .where(eq(sourceCategoryMappingCategory.categoryId, categoryId));

    const previousIds = new Set(previouslyLinked.map((row) => row.mappingId));
    const nextIds = new Set(uniqueIds);
    const detached = [...previousIds].filter((id) => !nextIds.has(id));
    const attached = uniqueIds;

    const touchedMappingIds = [...new Set([...detached, ...attached])];
    const touchedMappings =
      touchedMappingIds.length > 0
        ? await tx.select().from(sourceCategoryMapping).where(inArray(sourceCategoryMapping.id, touchedMappingIds))
        : [];
    const touchedSourceValues = touchedMappings.map((row) => row.sourceValue);

    for (const mappingId of detached) {
      await tx
        .delete(sourceCategoryMappingCategory)
        .where(
          and(
            eq(sourceCategoryMappingCategory.mappingId, mappingId),
            eq(sourceCategoryMappingCategory.categoryId, categoryId),
          ),
        );
      const remaining = await tx
        .select({ categoryId: sourceCategoryMappingCategory.categoryId })
        .from(sourceCategoryMappingCategory)
        .where(eq(sourceCategoryMappingCategory.mappingId, mappingId));
      if (remaining.length === 0) {
        await tx
          .update(sourceCategoryMapping)
          .set({ status: 'pending', suggestion: null, leaseUntil: null, updatedAt: new Date() })
          .where(eq(sourceCategoryMapping.id, mappingId));
      }
    }

    for (const mappingId of attached) {
      await tx.delete(sourceCategoryMappingCategory).where(eq(sourceCategoryMappingCategory.mappingId, mappingId));
      await tx.insert(sourceCategoryMappingCategory).values({ mappingId, categoryId });
      await tx
        .update(sourceCategoryMapping)
        .set({
          status: 'confirmed',
          suggestion: null,
          leaseUntil: null,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(sourceCategoryMapping.id, mappingId));
    }

    const recordIds = await findRecordIdsForMappings(tx, sourceId, touchedSourceValues);
    for (const recordId of recordIds) {
      await reconcileSourceCategoryAssignments(recordId, tx);
    }
  });
}

/** Link source terms onto main categories and recompute the affected records once. */
export async function attachShelfTermsToCategories(
  groups: Array<{ categoryId: string; mappingIds: string[] }>,
): Promise<void> {
  const sourceId = await resolveProjectGutenbergSourceId();
  const pairs = groups.flatMap((group) =>
    group.mappingIds.map((mappingId) => ({ categoryId: group.categoryId, mappingId })),
  );
  const uniqueIds = [...new Set(pairs.map((pair) => pair.mappingId))];
  if (uniqueIds.length === 0) return;

  await db.transaction(async (tx) => {
    const mappings = await tx
      .select()
      .from(sourceCategoryMapping)
      .where(
        and(
          eq(sourceCategoryMapping.sourceId, sourceId),
          inArray(sourceCategoryMapping.id, uniqueIds),
          sql`${sourceCategoryMapping.sourceValue} like ${GUTENBERG_CATEGORY_BOOKSHELF_PREFIX + '%'}`,
        ),
      );
    if (mappings.length !== uniqueIds.length) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_INVALID_INPUT);
    }

    for (const pair of pairs) {
      await tx.delete(sourceCategoryMappingCategory).where(eq(sourceCategoryMappingCategory.mappingId, pair.mappingId));
      await tx.insert(sourceCategoryMappingCategory).values(pair);
      await tx
        .update(sourceCategoryMapping)
        .set({
          status: 'confirmed',
          suggestion: null,
          leaseUntil: null,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(sourceCategoryMapping.id, pair.mappingId));
    }

    const recordIds = await findRecordIdsForMappings(
      tx,
      sourceId,
      mappings.map((row) => row.sourceValue),
    );
    for (const recordId of recordIds) {
      await reconcileSourceCategoryAssignments(recordId, tx);
    }
  });
}

/** Detach all shelf links and derived record rows before category delete. */
export async function detachCategoryShelfLinks(tx: ShelfTx, categoryId: string): Promise<void> {
  const links = await tx
    .select({ mappingId: sourceCategoryMappingCategory.mappingId })
    .from(sourceCategoryMappingCategory)
    .where(eq(sourceCategoryMappingCategory.categoryId, categoryId));
  await tx.delete(sourceCategoryMappingCategory).where(eq(sourceCategoryMappingCategory.categoryId, categoryId));
  for (const { mappingId } of links) {
    const remaining = await tx
      .select({ categoryId: sourceCategoryMappingCategory.categoryId })
      .from(sourceCategoryMappingCategory)
      .where(eq(sourceCategoryMappingCategory.mappingId, mappingId));
    if (remaining.length === 0) {
      await tx
        .update(sourceCategoryMapping)
        .set({ status: 'pending', suggestion: null, leaseUntil: null, updatedAt: new Date() })
        .where(eq(sourceCategoryMapping.id, mappingId));
    }
  }
  await tx.delete(sourceRecordPublicCategory).where(eq(sourceRecordPublicCategory.categoryId, categoryId));
}

export async function recomputeAllRecordsForConfirmedShelves(sourceId: string, tx?: ShelfTx): Promise<number> {
  const run = async (executor: ShelfTx) => {
    const mappings = await executor
      .select({ id: sourceCategoryMapping.id })
      .from(sourceCategoryMapping)
      .where(and(eq(sourceCategoryMapping.sourceId, sourceId), eq(sourceCategoryMapping.status, 'confirmed')));
    if (mappings.length === 0) return 0;
    const links = await executor
      .select({ mappingId: sourceCategoryMappingCategory.mappingId })
      .from(sourceCategoryMappingCategory)
      .where(
        inArray(
          sourceCategoryMappingCategory.mappingId,
          mappings.map((row) => row.id),
        ),
      );
    const mappingIds = new Set(links.map((row) => row.mappingId));
    const confirmed = await executor
      .select()
      .from(sourceCategoryMapping)
      .where(inArray(sourceCategoryMapping.id, [...mappingIds]));
    const sourceValues = confirmed
      .filter((row) => isGutenbergCategoryBookshelf(row.sourceValue))
      .map((row) => row.sourceValue);
    const recordIds = await findRecordIdsForMappings(executor, sourceId, sourceValues);
    for (const recordId of recordIds) {
      await reconcileSourceCategoryAssignments(recordId, executor);
    }
    return recordIds.length;
  };
  return tx ? run(tx) : db.transaction(run);
}

/** Ensure every Category: shelf mapping row exists (dev fold helper). */
export async function ensureCategoryShelfMappings(sourceId: string, terms: string[], tx: ShelfTx): Promise<void> {
  const values = new Map<string, string>();
  for (const term of terms) {
    if (!isGutenbergCategoryBookshelf(term)) continue;
    const normalized = normalizeSourceCategory(term);
    if (normalized && !values.has(normalized)) values.set(normalized, term.trim());
  }
  if (values.size === 0) return;
  await tx
    .insert(sourceCategoryMapping)
    .values(
      [...values].map(([normalizedValue, sourceValue]) => ({
        id: randomUUID(),
        sourceId,
        sourceValue,
        normalizedValue,
        status: 'pending' as const,
      })),
    )
    .onConflictDoNothing({ target: [sourceCategoryMapping.sourceId, sourceCategoryMapping.normalizedValue] });
}
