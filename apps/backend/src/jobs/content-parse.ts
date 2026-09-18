import { randomUUID } from 'node:crypto';

import { UnrecoverableError } from 'bullmq';

import { JOB_METADATA_FILL } from '@/jobs/work-metadata-fill';
import { enqueue } from '@/lib/queue';
import { failWorkflowEnqueue, rotateWorkflowJobToken } from '@/lib/workflow';
import { WORKFLOW_AUTO_CHAIN } from '@/lib/workflow-policy';
import { processContentWork } from '@/modules/content-parser';
import { isEpubValidationError } from '@/modules/epub-ingest/archive/limits';

export const JOB_CONTENT_PARSE = 'content-parse';

export type ContentParseJobData = {
  workId: string;
  retryJobToken: string;
};

export async function processContentParse(
  data: ContentParseJobData,
  attemptToken = randomUUID(),
): Promise<{ ok: true; workId: string }> {
  try {
    if (!(await processContentWork(data.workId, data.retryJobToken, attemptToken))) {
      return { ok: true, workId: data.workId };
    }
  } catch (error) {
    // Invalid EPUB input is permanent; do not spend the queue's retry budget
    // on the same bytes. The workflow service has already recorded the failure.
    if (isEpubValidationError(error)) {
      throw new UnrecoverableError(error.message);
    }
    throw error;
  }
  // Auto-chain kept for future: when WORKFLOW_AUTO_CHAIN flips back to true,
  // parse success immediately queues metadata-fill without an admin click.
  if (WORKFLOW_AUTO_CHAIN) {
    const retryJobToken = randomUUID();
    const metadataEnqueueAttemptToken = randomUUID();
    if (
      !(await rotateWorkflowJobToken(
        data.workId,
        'parse',
        'metadata',
        data.retryJobToken,
        attemptToken,
        retryJobToken,
        metadataEnqueueAttemptToken,
        'metadata',
        'metadata',
      ))
    ) {
      return { ok: true, workId: data.workId };
    }
    try {
      await enqueue(
        JOB_METADATA_FILL,
        { workId: data.workId, retryJobToken },
        { attempts: 2, jobId: `${JOB_METADATA_FILL}:${data.workId}:${retryJobToken}` },
      );
    } catch (error) {
      await failWorkflowEnqueue(data.workId, 'metadata', retryJobToken, 'metadata', metadataEnqueueAttemptToken, error);
      throw error;
    }
  }
  return { ok: true, workId: data.workId };
}
