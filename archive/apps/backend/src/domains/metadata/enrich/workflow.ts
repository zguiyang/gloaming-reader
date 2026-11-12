import type { MetadataFieldId } from '@/domains/metadata/enrich/fields';
import { completeWorkflowStep } from '@/domains/works/lifecycle';

export type CompleteMetadataStepResult = {
  completed: boolean;
};

/**
 * Complete the `metadata` step → `ready`.
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
      ? await completeWorkflowStep(workId, 'ready', metaPatch, 'metadata', retryJobToken, 'metadata', attemptToken)
      : await completeWorkflowStep(workId, 'ready', metaPatch, 'metadata');
  return { completed };
}
