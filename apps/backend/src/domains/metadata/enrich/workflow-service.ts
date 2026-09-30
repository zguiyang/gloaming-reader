import { eq } from 'drizzle-orm';

import { readingWork as readingWorkTable } from '@gloaming/db';

import { invokeMetadataAiEnrichment, isModelNotConfigured } from '@/domains/metadata/enrich/ai-enrichment';
import { computeMetadataEnrichGaps, selectFieldsNeedingAi } from '@/domains/metadata/enrich/candidate-selection';
import {
  loadBookContext,
  loadCatalogSubjects,
  loadCurrentCategory,
  loadCurrentTags,
} from '@/domains/metadata/enrich/context';
import { persistAiMetadataEnrichment } from '@/domains/metadata/enrich/taxonomy-sync';
import { completeMetadataStep } from '@/domains/metadata/enrich/workflow';
import { cleanSubjectsToProductTags } from '@/domains/metadata/fill/subjects';
import { db } from '@/infra/db';
import { rootLogger } from '@/infra/logging/logger';

const enrichLogger = rootLogger.child({ module: 'MetadataEnrich' });

export type EnrichWorkMetadataResult = {
  /** Whether enrichment finished without aborting the metadata workflow completion attempt. */
  ok: boolean;
  /** When true, the application job should enqueue TTS after a successful metadata step completion. */
  enqueueTts: boolean;
};

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
): Promise<EnrichWorkMetadataResult> {
  const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId)).limit(1);
  if (!work) {
    throw new Error(`Work ${workId} not found`);
  }
  if (work.ownerUserId !== null || work.visibility !== 'catalog') {
    return { ok: true, enqueueTts: false };
  }
  if (work.processingStatus !== 'metadata') {
    return { ok: true, enqueueTts: false };
  }

  const [currentTags, currentCategory, context] = await Promise.all([
    loadCurrentTags(workId),
    loadCurrentCategory(workId),
    loadBookContext(workId),
  ]);

  const needed = selectFieldsNeedingAi(currentTags, currentCategory, work.description);

  if (needed.size === 0) {
    const step = await completeMetadataStep(workId, retryJobToken, attemptToken);
    return { ok: step.completed, enqueueTts: step.enqueueTts };
  }

  const catalogSubjects = loadCatalogSubjects(work);
  const ruleTagCandidates = cleanSubjectsToProductTags(catalogSubjects);

  try {
    const result = await invokeMetadataAiEnrichment(
      work,
      workId,
      needed,
      context,
      currentTags,
      catalogSubjects,
      ruleTagCandidates,
    );
    await persistAiMetadataEnrichment(workId, needed, result.content);
  } catch (error) {
    if (isModelNotConfigured(error)) {
      const step = await completeMetadataStep(workId, retryJobToken, attemptToken, [...needed]);
      return { ok: step.completed, enqueueTts: step.enqueueTts };
    }
    throw error;
  }

  const [after] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId)).limit(1);
  const [afterTags, afterCategory] = await Promise.all([loadCurrentTags(workId), loadCurrentCategory(workId)]);
  const gaps = computeMetadataEnrichGaps(needed, afterTags, afterCategory, after?.description);

  const step = await completeMetadataStep(workId, retryJobToken, attemptToken, gaps);
  if (step.completed && gaps.length > 0) {
    enrichLogger.warn({ workId, missingFields: gaps }, 'Metadata enrich completed with fields left unfilled');
  }
  return { ok: step.completed, enqueueTts: step.enqueueTts };
}
