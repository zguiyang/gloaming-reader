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
import type { LocalizedTextMap } from '@gloaming/shared/taxonomy';

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
import {
  aiFillableFields,
  buildMetadataOutputSchema,
  type CleanTaxonomyRef,
  metadataFieldRegistry,
} from '@/modules/metadata-enrich/registry';
import {
  areWorkTagsWeak,
  isCategoryWeak,
  mergeTaxonomyLocalizedNames,
} from '@/modules/metadata-enrich/taxonomy-localized';
import { listCategoriesTool, listExistingTagsTool } from '@/modules/metadata-enrich/tools';
import { cleanSubjectsToProductTags } from '@/modules/metadata-fill/subjects';

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

type TaxonomyProvenance = 'extracted' | 'ai' | 'manual';
type WorkTagSnapshot = { name: string; localizedNames: LocalizedTextMap; provenance: TaxonomyProvenance };

async function loadCurrentTags(workId: string): Promise<WorkTagSnapshot[]> {
  const rows = await db
    .select({
      name: tagTable.name,
      localizedNames: tagTable.localizedNames,
      provenance: readingWorkTagTable.provenance,
    })
    .from(readingWorkTagTable)
    .innerJoin(tagTable, eq(readingWorkTagTable.tagId, tagTable.id))
    .where(eq(readingWorkTagTable.workId, workId));
  return rows.map((row) => ({
    name: row.name,
    localizedNames: row.localizedNames ?? {},
    provenance: row.provenance,
  }));
}

type WorkCategorySnapshot = { name: string; localizedNames: LocalizedTextMap; provenance: TaxonomyProvenance };

async function loadCurrentCategory(workId: string): Promise<WorkCategorySnapshot | undefined> {
  const [row] = await db
    .select({
      name: categoryTable.name,
      localizedNames: categoryTable.localizedNames,
      provenance: readingWorkCategoryTable.provenance,
    })
    .from(readingWorkCategoryTable)
    .innerJoin(categoryTable, eq(readingWorkCategoryTable.categoryId, categoryTable.id))
    .where(eq(readingWorkCategoryTable.workId, workId))
    .limit(1);
  return row ? { name: row.name, localizedNames: row.localizedNames ?? {}, provenance: row.provenance } : undefined;
}

function hasNonManualTaxonomy(rows: Array<{ provenance: TaxonomyProvenance }>): boolean {
  return rows.some((row) => row.provenance !== 'manual');
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
      if (hasNonManualTaxonomy(currentTags) || areWorkTagsWeak(currentTags)) needed.add(id);
      continue;
    }
    if (id === 'category') {
      if ((currentCategory && currentCategory.provenance !== 'manual') || isCategoryWeak(currentCategory)) {
        needed.add(id);
      }
      continue;
    }
    const def = metadataFieldRegistry[id];
    if (def.isWeak(work.description)) {
      needed.add(id);
    }
  }

  if (needed.size === 0) {
    return completeMetadataStep(workId, retryJobToken, attemptToken);
  }

  const catalogSubjects = loadCatalogSubjects(work);
  const ruleTagCandidates = cleanSubjectsToProductTags(catalogSubjects);
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
        existingTags: currentTags.map((tag) => tag.name),
        catalogSubjects,
        ruleTagCandidates,
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
      // No AI result means no generated taxonomy is persisted; surface the
      // required fields as gaps for an explicit retry.
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

    // Tags — the AI result is the final generated set. Remove only generated
    // associations, then reuse/create the returned dimensions. Manual tags stay.
    const aiTags = metadataFieldRegistry.tags.normalize(result.content.tags) as CleanTaxonomyRef[] | undefined;
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

    // Category — single-select. Same adjudication as tags; a stale generated
    // category must not survive when the AI cannot produce a valid replacement.
    const aiCategory = metadataFieldRegistry.category.normalize(result.content.category) as
      CleanTaxonomyRef | undefined;
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

  // Re-read after apply — still-weak required fields are partial completion.
  const [after] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId)).limit(1);
  const [afterTags, afterCategory] = await Promise.all([loadCurrentTags(workId), loadCurrentCategory(workId)]);
  const gaps: MetadataFieldId[] = [];
  for (const id of needed) {
    if (id === 'tags') {
      if (areWorkTagsWeak(afterTags)) gaps.push(id);
      continue;
    }
    if (id === 'category') {
      if (isCategoryWeak(afterCategory)) gaps.push(id);
      continue;
    }
    const def = metadataFieldRegistry[id];
    if (def.isWeak(after?.description ?? '')) gaps.push(id);
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
  tag: CleanTaxonomyRef,
): Promise<string | null> {
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
async function resolveCategoryId(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  category: CleanTaxonomyRef,
): Promise<string | null> {
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

async function applyTagLocalizedNames(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  id: string,
  existing: LocalizedTextMap | null | undefined,
  incoming: LocalizedTextMap,
): Promise<void> {
  const localizedNames = mergeTaxonomyLocalizedNames(existing, incoming);
  await tx.update(tagTable).set({ localizedNames }).where(eq(tagTable.id, id));
}

async function applyCategoryLocalizedNames(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  id: string,
  existing: LocalizedTextMap | null | undefined,
  incoming: LocalizedTextMap,
): Promise<void> {
  const localizedNames = mergeTaxonomyLocalizedNames(existing, incoming);
  await tx.update(categoryTable).set({ localizedNames }).where(eq(categoryTable.id, id));
}

async function upsertTagId(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  name: string,
  localizedNames: LocalizedTextMap,
): Promise<string | null> {
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
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
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
