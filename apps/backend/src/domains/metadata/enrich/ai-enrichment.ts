import type { z } from 'zod';

import type { readingWork as readingWorkTable } from '@gloaming/db';

import { type AiInvokeResult, invokeAi } from '@/domains/ai';
import type { BookContext } from '@/domains/metadata/enrich/context';
import type { MetadataFieldId } from '@/domains/metadata/enrich/fields';
import { buildEnrichMessages } from '@/domains/metadata/enrich/prompt';
import { buildMetadataOutputSchema } from '@/domains/metadata/enrich/registry';
import { HTTP_STATUS } from '@/shared/constants';
import { AppError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

export function isModelNotConfigured(error: unknown): boolean {
  return (
    error instanceof AppError &&
    error.statusCode === HTTP_STATUS.SERVICE_UNAVAILABLE &&
    error.code === ERROR_CODES.AI.MODEL_NOT_CONFIGURED
  );
}

export async function invokeMetadataAiEnrichment(
  work: typeof readingWorkTable.$inferSelect,
  workId: string,
  context: BookContext,
): Promise<AiInvokeResult<z.infer<ReturnType<typeof buildMetadataOutputSchema>>>> {
  const requiredFields: MetadataFieldId[] = ['description'];
  return invokeAi({
    purpose: 'metadata-enrich',
    source: 'metadata-enrich.fill',
    ref: { type: 'reading_work', id: workId },
    messages: buildEnrichMessages({
      title: work.title,
      author: work.author,
      language: work.language,
      description: work.description,
      excerpt: context.excerpt,
      tocTitles: context.tocTitles,
    }),
    outputSchema: buildMetadataOutputSchema(requiredFields),
    requestSummaryExtra: { workId, neededFields: requiredFields.join(',') },
  });
}
