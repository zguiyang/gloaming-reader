import { randomUUID } from 'node:crypto';

import { enqueueWorkAudio } from '@/domains/assets';
import { enrichWorkMetadata } from '@/domains/metadata';
import { claimWorkflowStep, failWorkflowEnqueue, failWorkflowStep } from '@/domains/works/lifecycle';
import { rootLogger } from '@/infra/logging/logger';

export const JOB_METADATA_ENRICH = 'metadata-enrich';

export type MetadataEnrichJobData = {
  workId: string;
  retryJobToken: string;
};

const enrichJobLogger = rootLogger.child({ module: 'MetadataEnrichJob' });

/**
 * AI backfill job (step `metadata`, attempts: 2, at-least-once). Failure
 * surfaces as `failed` + `failedStep: metadata`; the BullMQ retry re-claims the
 * step (self-heal). The model-not-configured case degrades inside the service
 * and completes the step without AI.
 */
export async function processMetadataEnrich(
  data: MetadataEnrichJobData,
  attemptToken = randomUUID(),
): Promise<{ ok: true; workId: string }> {
  if (!(await claimWorkflowStep(data.workId, 'metadata', data.retryJobToken, attemptToken))) {
    return { ok: true, workId: data.workId };
  }
  try {
    const { enqueueTts } = await enrichWorkMetadata(data.workId, data.retryJobToken, attemptToken);
    if (enqueueTts) {
      try {
        await enqueueWorkAudio(data.workId, { force: false, roles: ['us', 'uk'] });
      } catch (error) {
        await failWorkflowEnqueue(data.workId, 'tts', data.retryJobToken, 'tts', attemptToken, error);
        throw error;
      }
    }
  } catch (error) {
    enrichJobLogger.error({ err: error, workId: data.workId }, 'Metadata enrich failed');
    await failWorkflowStep(data.workId, 'metadata', data.retryJobToken, attemptToken, error);
    throw error;
  }
  return { ok: true, workId: data.workId };
}
