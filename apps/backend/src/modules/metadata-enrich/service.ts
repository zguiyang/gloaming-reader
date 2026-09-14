import { randomUUID } from 'node:crypto';

import { and, asc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';

import {
  category as categoryTable,
  readingPart as readingPartTable,
  readingWork as readingWorkTable,
  readingWorkCategory as readingWorkCategoryTable,
  readingWorkTag as readingWorkTagTable,
  tag as tagTable,
} from '@gloaming/db';

import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { ERROR_CODES } from '@/lib/error-codes';
import { AppError } from '@/lib/errors';
import { rootLogger } from '@/lib/logger';
import { normalizeTag } from '@/lib/text';
import { completeWorkflowStep, failWorkflowEnqueue, workflowLeaseExpiresAt } from '@/lib/workflow';
import { TTS_STEP_ENABLED } from '@/lib/workflow-policy';
import { type AiInvokeResult, invokeAi } from '@/modules/ai';
import type { MetadataFieldId } from '@/modules/metadata-enrich/fields';
import { buildEnrichMessages, EXCERPT_MAX_CHARS, TOC_TITLE_MAX } from '@/modules/metadata-enrich/prompt';
import { aiFillableFields, buildMetadataOutputSchema, metadataFieldRegistry } from '@/modules/metadata-enrich/registry';
import { listCategoriesTool, listExistingTagsTool } from '@/modules/metadata-enrich/tools';
import { areProductTagsWeak } from '@/modules/metadata-fill/subjects';

const enrichLogger = rootLogger.child({ module: 'MetadataEnrich' });

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCountOf(text: string): number {
  return stripHtml(text).split(/\s+/).filter(Boolean).length;
}

async function loadBookContext(workId: string): Promise<{ excerpt: string; tocTitles: string[] }> {
  const parts = await db
    .select({ title: readingPartTable.title, body: readingPartTable.body })
    .from(readingPartTable)
    .where(eq(readingPartTable.workId, workId))
    .orderBy(asc(readingPartTable.sortOrder), asc(readingPartTable.id));
  const tocTitles = parts
    .map((p) => p.title.trim())
    .filter(Boolean)
    .slice(0, TOC_TITLE_MAX);
  const target = parts.find((p) => wordCountOf(p.body) >= 100) ?? parts[0];
  const excerpt = target ? stripHtml(target.body).slice(0, EXCERPT_MAX_CHARS) : '';
  return { excerpt, tocTitles };
}

async function loadCurrentTags(workId: string): Promise<string[]> {
  const rows = await db
    .select({ name: tagTable.name })
    .from(readingWorkTagTable)
    .innerJoin(tagTable, eq(readingWorkTagTable.tagId, tagTable.id))
    .where(eq(readingWorkTagTable.workId, workId));
  return rows.map((row) => row.name);
}

async function loadCurrentCategory(workId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ name: categoryTable.name })
    .from(readingWorkCategoryTable)
    .innerJoin(categoryTable, eq(readingWorkCategoryTable.categoryId, categoryTable.id))
    .where(eq(readingWorkCategoryTable.workId, workId))
    .limit(1);
  return row?.name;
}

function loadCatalogSubjects(work: typeof readingWorkTable.$inferSelect): string[] {
  const parsed = (work.originMeta as Record<string, unknown> | undefined)?.parsed;
  if (!parsed || typeof parsed !== 'object') return [];
  const subjects = (parsed as Record<string, unknown>).subjects;
  if (!Array.isArray(subjects)) return [];
  return subjects.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
}

/** Only true model-missing 503s degrade; other 503s (timeout, bad JSON) must fail the step. */
function isModelNotConfigured(error: unknown): boolean {
  return (
    error instanceof AppError &&
    error.statusCode === HTTP_STATUS.SERVICE_UNAVAILABLE &&
    error.code === ERROR_CODES.AI.MODEL_NOT_CONFIGURED
  );
}

const FIELD_GAP_LABEL: Partial<Record<MetadataFieldId, string>> = {
  description: '简介',
  tags: '标签',
  category: '分类',
};

/**
 * Complete the `metadata` step. Default (`TTS_STEP_ENABLED=false`): → `ready`.
 * When the TTS pipeline flag is on: → `tts` and auto-enqueue dual-accent audio.
 * `gaps` records AI targets that stayed empty/weak so the admin UI can show
 * partial completion instead of a false "done".
 */
async function completeMetadataStep(
  workId: string,
  retryJobToken: string | undefined,
  attemptToken: string | undefined,
  gaps: MetadataFieldId[] = [],
): Promise<boolean> {
  const uniqueGaps = [...new Set(gaps)];
  const metaPatch = {
    metadataAt: new Date().toISOString(),
    metadataEnrichGaps: uniqueGaps.length > 0 ? uniqueGaps : undefined,
    metadataEnrichError:
      uniqueGaps.length > 0 ? `未补全：${uniqueGaps.map((id) => FIELD_GAP_LABEL[id] ?? id).join('、')}` : undefined,
  };
  const completed =
    retryJobToken && attemptToken
      ? await completeWorkflowStep(
          workId,
          TTS_STEP_ENABLED ? 'tts' : 'ready',
          TTS_STEP_ENABLED
            ? {
                ...metaPatch,
                workflowEnqueueStep: 'tts',
                workflowEnqueueAttempt: attemptToken,
                workflowEnqueueLeaseExpiresAt: workflowLeaseExpiresAt(),
              }
            : metaPatch,
          'metadata',
          retryJobToken,
          'metadata',
          attemptToken,
        )
      : await completeWorkflowStep(workId, TTS_STEP_ENABLED ? 'tts' : 'ready', metaPatch, 'metadata');
  if (!completed) {
    return false;
  }
  if (TTS_STEP_ENABLED) {
    const { enqueueWorkAudio } = await import('@/modules/content-assets/service');
    try {
      await enqueueWorkAudio(workId, { force: false, roles: ['us', 'uk'] });
    } catch (error) {
      if (retryJobToken && attemptToken) {
        await failWorkflowEnqueue(workId, 'tts', retryJobToken, 'tts', attemptToken, error);
      }
      throw error;
    }
  }
  return true;
}

/**
 * AI backfill orchestration — fills empty/weak fields only (never overrides
 * manual values). Short-circuits with zero cost when nothing is needed.
 * Model-not-configured degrades to a completed step (rules already landed);
 * other failures bubble up so the job can fail the step and retry.
 */
export async function enrichWorkMetadata(
  workId: string,
  retryJobToken?: string,
  attemptToken?: string,
): Promise<boolean> {
  const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId)).limit(1);
  if (!work) {
    throw new Error(`Work ${workId} not found`);
  }
  if (work.originKind !== 'admin_epub') {
    return true;
  }
  if (work.status !== 'metadata') {
    return true;
  }

  const [currentTags, currentCategory, context] = await Promise.all([
    loadCurrentTags(workId),
    loadCurrentCategory(workId),
    loadBookContext(workId),
  ]);

  const needed = new Set<(typeof aiFillableFields)[number]>();
  for (const id of aiFillableFields) {
    if (id === 'tags') {
      if (areProductTagsWeak(currentTags)) needed.add(id);
      continue;
    }
    const def = metadataFieldRegistry[id];
    const current = id === 'description' ? work.description : (currentCategory ?? '');
    if (def.isWeak(current)) {
      needed.add(id);
    }
  }

  if (needed.size === 0) {
    return completeMetadataStep(workId, retryJobToken, attemptToken);
  }

  const catalogSubjects = loadCatalogSubjects(work);
  const outputSchema = buildMetadataOutputSchema([...needed]);
  let result: AiInvokeResult<z.infer<typeof outputSchema>>;
  try {
    result = await invokeAi({
      purpose: 'metadata-enrich',
      source: 'metadata-enrich.fill',
      ref: { type: 'reading_work', id: workId },
      messages: buildEnrichMessages({
        title: work.title,
        author: work.author,
        language: work.language,
        existingTags: currentTags,
        catalogSubjects,
        ruleDescription: work.description,
        excerpt: context.excerpt,
        tocTitles: context.tocTitles,
        requiredFields: [...needed],
      }),
      tools: [listExistingTagsTool(), listCategoriesTool()],
      outputSchema,
      requestSummaryExtra: { workId, neededFields: [...needed].join(',') },
    });
  } catch (error) {
    if (isModelNotConfigured(error)) {
      // Rules already landed; surface remaining AI targets as gaps.
      return completeMetadataStep(workId, retryJobToken, attemptToken, [...needed]);
    }
    throw error;
  }

  await db.transaction(async (tx) => {
    const patch: Partial<typeof readingWorkTable.$inferInsert> = {};

    const aiDescription = metadataFieldRegistry.description.normalize(result.content.description);
    if (needed.has('description') && typeof aiDescription === 'string') {
      patch.description = aiDescription;
      patch.descriptionProvenance = 'ai';
    }

    // Tags — model returns { id, name } (id null = create). Intent is advisory:
    // ids are validated, and names always fall back to normalized reuse-first upserts
    // (never duplicate dimensions). When AI fills weak tags, replace extracted+ai
    // associations (keep manual).
    const aiTags = metadataFieldRegistry.tags.normalize(result.content.tags) as
      Array<{ name: string; existingId?: string }> | undefined;
    if (needed.has('tags') && Array.isArray(aiTags)) {
      const tagIds: string[] = [];
      for (const tag of aiTags) {
        const id = await resolveTagId(tx, tag);
        if (id) tagIds.push(id);
      }
      if (tagIds.length > 0) {
        await tx
          .delete(readingWorkTagTable)
          .where(
            and(eq(readingWorkTagTable.workId, workId), inArray(readingWorkTagTable.provenance, ['extracted', 'ai'])),
          );
        for (const tagId of tagIds) {
          await tx.insert(readingWorkTagTable).values({ workId, tagId, provenance: 'ai' }).onConflictDoNothing();
        }
      }
    }

    // Category — single-select. Same adjudication as tags.
    const aiCategory = metadataFieldRegistry.category.normalize(result.content.category) as
      { name: string; existingId?: string } | undefined;
    if (needed.has('category') && aiCategory) {
      const categoryId = await resolveCategoryId(tx, aiCategory);
      if (categoryId) {
        await tx
          .delete(readingWorkCategoryTable)
          .where(
            and(
              eq(readingWorkCategoryTable.workId, workId),
              inArray(readingWorkCategoryTable.provenance, ['extracted', 'ai']),
            ),
          );
        await tx
          .insert(readingWorkCategoryTable)
          .values({ workId, categoryId, provenance: 'ai' })
          .onConflictDoNothing();
      }
    }

    if (Object.keys(patch).length > 0) {
      await tx.update(readingWorkTable).set(patch).where(eq(readingWorkTable.id, workId));
    }
  });

  // Re-read after apply — still-weak required fields are partial completion.
  const [after] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId)).limit(1);
  const [afterTags, afterCategory] = await Promise.all([loadCurrentTags(workId), loadCurrentCategory(workId)]);
  const gaps: MetadataFieldId[] = [];
  for (const id of needed) {
    if (id === 'tags') {
      if (areProductTagsWeak(afterTags)) gaps.push(id);
      continue;
    }
    const def = metadataFieldRegistry[id];
    const current = id === 'description' ? (after?.description ?? '') : (afterCategory ?? '');
    if (def.isWeak(current)) gaps.push(id);
  }

  const completed = await completeMetadataStep(workId, retryJobToken, attemptToken, gaps);
  if (!completed) {
    return false;
  }
  if (gaps.length > 0) {
    enrichLogger.warn({ workId, missingFields: gaps }, 'Metadata enrich completed with fields left unfilled');
  }
  return true;
}

/** Resolve a tag ref to a concrete dimension id — reuse validated, then normalized, then create. */
async function resolveTagId(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  tag: { name: string; existingId?: string },
): Promise<string | null> {
  if (tag.existingId) {
    const [row] = await tx.select({ id: tagTable.id }).from(tagTable).where(eq(tagTable.id, tag.existingId)).limit(1);
    if (row) return row.id;
  }
  return upsertTagId(tx, tag.name);
}

/** Category ref — same adjudication, single row. */
async function resolveCategoryId(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  category: { name: string; existingId?: string },
): Promise<string | null> {
  if (category.existingId) {
    const [row] = await tx
      .select({ id: categoryTable.id })
      .from(categoryTable)
      .where(eq(categoryTable.id, category.existingId))
      .limit(1);
    if (row) return row.id;
  }
  return upsertCategoryId(tx, category.name);
}

async function upsertTagId(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  name: string,
): Promise<string | null> {
  const [row] = await tx
    .insert(tagTable)
    .values({ id: randomUUID(), name, normalized: normalizeTag(name), origin: 'ai' })
    .onConflictDoUpdate({ target: tagTable.normalized, set: { name } })
    .returning();
  return row?.id ?? null;
}

async function upsertCategoryId(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  name: string,
): Promise<string | null> {
  const [row] = await tx
    .insert(categoryTable)
    .values({ id: randomUUID(), name, normalized: normalizeTag(name), origin: 'ai' })
    .onConflictDoUpdate({ target: categoryTable.normalized, set: { name } })
    .returning();
  return row?.id ?? null;
}
