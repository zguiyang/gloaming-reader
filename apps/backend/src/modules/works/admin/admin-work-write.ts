import { randomUUID } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';

import {
  category as categoryTable,
  readingPart as readingPartTable,
  readingWork as readingWorkTable,
  readingWorkCategory as readingWorkCategoryTable,
  readingWorkSource as readingWorkSourceTable,
  readingWorkTag as readingWorkTagTable,
  source as sourceTable,
  tag as tagTable,
} from '@gloaming/db';
import type { AdminWork, CreateAdminTextWorkBody, UpdateWorkBody } from '@gloaming/shared/works';

import { db } from '@/db';
import { AppError, NotFoundError } from '@/lib/errors/app-error';
import { ERROR_CODES } from '@/lib/errors/codes';
import { computePartReadingStats, computeWorkReadingStats } from '@/modules/reading-stats/service';
import { getAdminWork, toAdminWork } from '@/modules/works/admin/admin-work-read';

/** Escape text for HTML body storage. */
function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Convert a plain-text body (textarea input) into paragraph HTML. */
function textToParagraphHtml(body: string): string {
  return body
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtmlText(paragraph)}</p>`)
    .join('\n');
}

/** Internal admin_text seed — creates one work + one body part (stored as HTML). */
export async function createAdminTextWork(input: CreateAdminTextWorkBody): Promise<AdminWork> {
  const workId = randomUUID();
  const partId = randomUUID();

  const [workRow] = await db
    .insert(readingWorkTable)
    .values({
      id: workId,
      title: input.title,
      description: '',
      status: 'ready',
      originKind: 'admin_text',
      publishedAt: null,
    })
    .returning();

  if (!workRow) {
    throw new AppError(500, ERROR_CODES.WORK.CREATE_FAILED);
  }

  const bodyHtml = textToParagraphHtml(input.body);
  const partStats = computePartReadingStats(bodyHtml);
  const workStats = computeWorkReadingStats([{ body: bodyHtml }], workRow.language);

  const [partRow] = await db
    .insert(readingPartTable)
    .values({
      id: partId,
      workId,
      sortOrder: 0,
      kind: 'body',
      title: input.title,
      body: bodyHtml,
      meta: { wordCount: partStats.wordCount },
    })
    .returning();

  if (!partRow) {
    throw new AppError(500, ERROR_CODES.WORK.CREATE_PART_FAILED);
  }

  const [updatedWork] = await db
    .update(readingWorkTable)
    .set({
      wordCount: workStats.wordCount,
      estimatedMinutes: workStats.estimatedMinutes,
      suggestedVocabSize: workStats.suggestedVocabSize,
      difficultyScore: workStats.difficultyScore,
      statsProvenance: workStats.statsProvenance,
    })
    .where(eq(readingWorkTable.id, workId))
    .returning();

  return toAdminWork(updatedWork ?? workRow, [partRow]);
}

export async function updateWork(id: string, input: UpdateWorkBody): Promise<AdminWork> {
  const [existing] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, id)).limit(1);
  if (!existing) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
  }

  const patch: Partial<typeof readingWorkTable.$inferInsert> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.author !== undefined) patch.author = input.author;
  if (input.description !== undefined) {
    patch.description = input.description;
    patch.descriptionProvenance = 'manual';
  }
  if (input.suggestedVocabSize !== undefined) {
    patch.suggestedVocabSize = input.suggestedVocabSize;
    patch.statsProvenance = 'manual';
  }
  if (input.difficultyScore !== undefined) {
    patch.difficultyScore = input.difficultyScore;
    patch.statsProvenance = 'manual';
  }

  if (
    input.tags === undefined &&
    input.sources === undefined &&
    input.category === undefined &&
    input.suggestedVocabSize === undefined &&
    input.difficultyScore === undefined &&
    Object.keys(patch).length === 0
  ) {
    return toAdminWork(existing);
  }

  await db.transaction(async (tx) => {
    if (input.tags !== undefined) {
      const tagIds = [...new Set(input.tags.map((tag) => tag.id))];
      if (tagIds.length > 0) {
        const existing = await tx.select({ id: tagTable.id }).from(tagTable).where(inArray(tagTable.id, tagIds));
        if (existing.length !== tagIds.length) {
          throw new NotFoundError(ERROR_CODES.NOT_FOUND.TAXONOMY_TAG);
        }
      }
      await tx
        .delete(readingWorkTagTable)
        .where(and(eq(readingWorkTagTable.workId, id), eq(readingWorkTagTable.provenance, 'manual')));
      if (tagIds.length > 0) {
        await tx
          .insert(readingWorkTagTable)
          .values(tagIds.map((tagId) => ({ workId: id, tagId, provenance: 'manual' as const })))
          .onConflictDoNothing();
      }
    }

    if (input.sources !== undefined) {
      const sourceIds = [...new Set(input.sources.map((source) => source.id))];
      if (sourceIds.length > 0) {
        const existing = await tx
          .select({ id: sourceTable.id })
          .from(sourceTable)
          .where(inArray(sourceTable.id, sourceIds));
        if (existing.length !== sourceIds.length) {
          throw new NotFoundError(ERROR_CODES.NOT_FOUND.TAXONOMY_SOURCE);
        }
      }
      await tx
        .delete(readingWorkSourceTable)
        .where(and(eq(readingWorkSourceTable.workId, id), eq(readingWorkSourceTable.provenance, 'manual')));
      if (sourceIds.length > 0) {
        await tx
          .insert(readingWorkSourceTable)
          .values(sourceIds.map((sourceId) => ({ workId: id, sourceId, provenance: 'manual' as const })))
          .onConflictDoNothing();
      }
    }

    // Category: single-select — null clears; stable id replaces every association (manual).
    if (input.category !== undefined) {
      await tx.delete(readingWorkCategoryTable).where(eq(readingWorkCategoryTable.workId, id));
      if (input.category !== null) {
        const [categoryRow] = await tx
          .select({ id: categoryTable.id })
          .from(categoryTable)
          .where(eq(categoryTable.id, input.category.id))
          .limit(1);
        if (!categoryRow) {
          throw new NotFoundError(ERROR_CODES.NOT_FOUND.TAXONOMY_CATEGORY);
        }
        await tx
          .insert(readingWorkCategoryTable)
          .values({ workId: id, categoryId: categoryRow.id, provenance: 'manual' })
          .onConflictDoNothing();
      }
    }

    if (Object.keys(patch).length > 0) {
      await tx.update(readingWorkTable).set(patch).where(eq(readingWorkTable.id, id));
    }
  });

  return getAdminWork(id);
}
