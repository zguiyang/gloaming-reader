import { randomUUID } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';

import {
  category as categoryTable,
  readingWork as readingWorkTable,
  readingWorkCategory as readingWorkCategoryTable,
  readingWorkTag as readingWorkTagTable,
  tag as tagTable,
} from '@gloaming/db';
import type { LocalizedTextMap } from '@gloaming/shared/taxonomy';

import type { MetadataFieldId } from '@/domains/metadata/enrich/fields';
import type { buildMetadataOutputSchema } from '@/domains/metadata/enrich/registry';
import { type CleanTaxonomyRef, metadataFieldRegistry } from '@/domains/metadata/enrich/registry';
import { mergeTaxonomyLocalizedNames } from '@/domains/metadata/enrich/taxonomy-localized';
import { normalizeTag } from '@/domains/taxonomy';
import { db } from '@/infra/db';

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function applyTagLocalizedNames(
  tx: DbTransaction,
  id: string,
  existing: LocalizedTextMap | null | undefined,
  incoming: LocalizedTextMap,
): Promise<void> {
  const localizedNames = mergeTaxonomyLocalizedNames(existing, incoming);
  await tx.update(tagTable).set({ localizedNames }).where(eq(tagTable.id, id));
}

async function applyCategoryLocalizedNames(
  tx: DbTransaction,
  id: string,
  existing: LocalizedTextMap | null | undefined,
  incoming: LocalizedTextMap,
): Promise<void> {
  const localizedNames = mergeTaxonomyLocalizedNames(existing, incoming);
  await tx.update(categoryTable).set({ localizedNames }).where(eq(categoryTable.id, id));
}

async function upsertTagId(tx: DbTransaction, name: string, localizedNames: LocalizedTextMap): Promise<string | null> {
  const normalized = normalizeTag(name);
  const [existing] = await tx.select().from(tagTable).where(eq(tagTable.normalized, normalized)).limit(1);
  if (existing) {
    const merged = mergeTaxonomyLocalizedNames(existing.localizedNames, localizedNames);
    await tx.update(tagTable).set({ localizedNames: merged }).where(eq(tagTable.id, existing.id));
    return existing.id;
  }
  const [row] = await tx
    .insert(tagTable)
    .values({ id: randomUUID(), name, normalized, localizedNames, origin: 'ai' })
    .onConflictDoUpdate({ target: tagTable.normalized, set: { name } })
    .returning();
  if (!row) return null;
  const merged = mergeTaxonomyLocalizedNames(row.localizedNames, localizedNames);
  await tx.update(tagTable).set({ localizedNames: merged }).where(eq(tagTable.id, row.id));
  return row.id;
}

async function upsertCategoryId(
  tx: DbTransaction,
  name: string,
  localizedNames: LocalizedTextMap,
): Promise<string | null> {
  const normalized = normalizeTag(name);
  const [existing] = await tx.select().from(categoryTable).where(eq(categoryTable.normalized, normalized)).limit(1);
  if (existing) {
    const merged = mergeTaxonomyLocalizedNames(existing.localizedNames, localizedNames);
    await tx.update(categoryTable).set({ localizedNames: merged }).where(eq(categoryTable.id, existing.id));
    return existing.id;
  }
  const [row] = await tx
    .insert(categoryTable)
    .values({ id: randomUUID(), name, normalized, localizedNames, origin: 'ai' })
    .onConflictDoUpdate({ target: categoryTable.normalized, set: { name } })
    .returning();
  if (!row) return null;
  const merged = mergeTaxonomyLocalizedNames(row.localizedNames, localizedNames);
  await tx.update(categoryTable).set({ localizedNames: merged }).where(eq(categoryTable.id, row.id));
  return row.id;
}

/** Resolve a tag ref to a concrete dimension id — reuse validated, then normalized, then create. */
async function resolveTagId(tx: DbTransaction, tag: CleanTaxonomyRef): Promise<string | null> {
  if (tag.existingId) {
    const [row] = await tx
      .select({ id: tagTable.id, localizedNames: tagTable.localizedNames })
      .from(tagTable)
      .where(eq(tagTable.id, tag.existingId))
      .limit(1);
    if (row) {
      await applyTagLocalizedNames(tx, row.id, row.localizedNames, tag.localizedNames);
      return row.id;
    }
  }
  return upsertTagId(tx, tag.name, tag.localizedNames);
}

/** Category ref — same adjudication, single row. */
async function resolveCategoryId(tx: DbTransaction, category: CleanTaxonomyRef): Promise<string | null> {
  if (category.existingId) {
    const [row] = await tx
      .select({ id: categoryTable.id, localizedNames: categoryTable.localizedNames })
      .from(categoryTable)
      .where(eq(categoryTable.id, category.existingId))
      .limit(1);
    if (row) {
      await applyCategoryLocalizedNames(tx, row.id, row.localizedNames, category.localizedNames);
      return row.id;
    }
  }
  return upsertCategoryId(tx, category.name, category.localizedNames);
}

export async function persistAiMetadataEnrichment(
  workId: string,
  needed: Set<MetadataFieldId>,
  content: z.infer<ReturnType<typeof buildMetadataOutputSchema>>,
): Promise<void> {
  await db.transaction(async (tx) => {
    const patch: Partial<typeof readingWorkTable.$inferInsert> = {};

    const aiDescription = metadataFieldRegistry.description.normalize(content.description);
    if (needed.has('description') && typeof aiDescription === 'string') {
      patch.description = aiDescription;
      patch.descriptionProvenance = 'ai';
    }

    const aiTags = metadataFieldRegistry.tags.normalize(content.tags) as CleanTaxonomyRef[] | undefined;
    if (needed.has('tags')) {
      await tx
        .delete(readingWorkTagTable)
        .where(
          and(eq(readingWorkTagTable.workId, workId), inArray(readingWorkTagTable.provenance, ['extracted', 'ai'])),
        );
      const tagIds: string[] = [];
      if (Array.isArray(aiTags)) {
        for (const tag of aiTags) {
          const id = await resolveTagId(tx, tag);
          if (id) tagIds.push(id);
        }
      }
      for (const tagId of tagIds) {
        await tx.insert(readingWorkTagTable).values({ workId, tagId, provenance: 'ai' }).onConflictDoNothing();
      }
    }

    const aiCategory = metadataFieldRegistry.category.normalize(content.category) as CleanTaxonomyRef | undefined;
    if (needed.has('category')) {
      await tx
        .delete(readingWorkCategoryTable)
        .where(
          and(
            eq(readingWorkCategoryTable.workId, workId),
            inArray(readingWorkCategoryTable.provenance, ['extracted', 'ai']),
          ),
        );
      if (aiCategory) {
        const categoryId = await resolveCategoryId(tx, aiCategory);
        if (categoryId) {
          await tx
            .insert(readingWorkCategoryTable)
            .values({ workId, categoryId, provenance: 'ai' })
            .onConflictDoNothing();
        }
      }
    }

    if (Object.keys(patch).length > 0) {
      await tx.update(readingWorkTable).set(patch).where(eq(readingWorkTable.id, workId));
    }
  });
}
