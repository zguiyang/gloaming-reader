import type { MetadataFieldId } from '@/domains/metadata/enrich/fields';
import { completeWorkflowStep, TTS_STEP_ENABLED, workflowLeaseExpiresAt } from '@/domains/works';

export type CompleteMetadataStepResult = {
  completed: boolean;
  enqueueTts: boolean;
};

/**
 * Complete the `metadata` step. Default (`TTS_STEP_ENABLED=false`): → `ready`.
 * When the TTS pipeline flag is on: → `tts` with enqueue lease metadata (audio
 * enqueue is orchestrated by the application job).
 * `gaps` records AI targets that stayed empty/weak so the admin UI can show
 * partial completion instead of a false "done".
 */
export async function completeMetadataStep(
  workId: string,
  retryJobToken: string | undefined,
  attemptToken: string | undefined,
  gaps: MetadataFieldId[] = [],
): Promise<CompleteMetadataStepResult> {
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
    return { completed: false, enqueueTts: false };
  }
  return { completed: true, enqueueTts: TTS_STEP_ENABLED };
}
