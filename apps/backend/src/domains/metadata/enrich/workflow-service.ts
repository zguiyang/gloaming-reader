import { and, eq } from 'drizzle-orm';

import { readingWork as readingWorkTable } from '@gloaming/db';

import { invokeMetadataAiEnrichment, isModelNotConfigured } from '@/domains/metadata/enrich/ai-enrichment';
import { computeMetadataEnrichGaps, selectFieldsNeedingAi } from '@/domains/metadata/enrich/candidate-selection';
import { loadBookContext } from '@/domains/metadata/enrich/context';
import { metadataFieldRegistry } from '@/domains/metadata/enrich/registry';
import { completeMetadataStep } from '@/domains/metadata/enrich/workflow';
import { db } from '@/infra/db';
import { rootLogger } from '@/infra/logging/logger';

const enrichLogger = rootLogger.child({ module: 'MetadataEnrich' });

export type EnrichWorkMetadataResult = {
  ok: boolean;
  enqueueTts: boolean;
};

/** Fill only a weak description; never replace a stronger or manually edited value. */
export async function enrichWorkMetadata(
  workId: string,
  retryJobToken?: string,
  attemptToken?: string,
): Promise<EnrichWorkMetadataResult> {
  const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId)).limit(1);
  if (!work) {
    throw new Error(`Work ${workId} not found`);
  }
  if (work.ownerUserId !== null || work.visibility !== 'catalog' || work.processingStatus !== 'metadata') {
    return { ok: true, enqueueTts: false };
  }

  const needed = selectFieldsNeedingAi(work.description);
  if (needed.size === 0) {
    const step = await completeMetadataStep(workId, retryJobToken, attemptToken);
    return { ok: step.completed, enqueueTts: step.enqueueTts };
  }

  try {
    const context = await loadBookContext(workId);
    const result = await invokeMetadataAiEnrichment(work, workId, context);
    const description = metadataFieldRegistry.description.normalize(result.content.description);
    if (description) {
      await db
        .update(readingWorkTable)
        .set({ description, descriptionProvenance: 'ai' })
        .where(and(eq(readingWorkTable.id, workId), eq(readingWorkTable.description, work.description)));
    }
  } catch (error) {
    if (isModelNotConfigured(error)) {
      const step = await completeMetadataStep(workId, retryJobToken, attemptToken, [...needed]);
      return { ok: step.completed, enqueueTts: step.enqueueTts };
    }
    throw error;
  }

  const [after] = await db
    .select({ description: readingWorkTable.description })
    .from(readingWorkTable)
    .where(eq(readingWorkTable.id, workId))
    .limit(1);
  const gaps = computeMetadataEnrichGaps(after?.description);
  const step = await completeMetadataStep(workId, retryJobToken, attemptToken, gaps);
  if (step.completed && gaps.length > 0) {
    enrichLogger.warn({ workId, missingFields: gaps }, 'Metadata enrich completed with fields left unfilled');
  }
  return { ok: step.completed, enqueueTts: step.enqueueTts };
}
