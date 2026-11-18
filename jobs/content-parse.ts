import { randomUUID } from 'node:crypto';

import { UnrecoverableError } from 'bullmq';

import { runContentParseWorkflow } from '@/server/application/commands/run-content-parse-workflow';
import { isEpubValidationError } from '@/server/domains/ingest/epub';
import { createLogger } from '@/server/infra/logging/logger';

export const JOB_CONTENT_PARSE = 'content-parse';

const parseLogger = createLogger('ContentParseJob');

export type ContentParseJobData = {
  workId: string;
  retryJobToken: string;
};

export async function processContentParse(
  data: ContentParseJobData,
  attemptToken = randomUUID(),
): Promise<{ ok: true; workId: string }> {
  try {
    if (!(await runContentParseWorkflow(data.workId, data.retryJobToken, attemptToken))) {
      return { ok: true, workId: data.workId };
    }
  } catch (error) {
    parseLogger.warn({ err: error, workId: data.workId }, 'Content parse job failed');
    if (isEpubValidationError(error)) {
      throw new UnrecoverableError(error.message);
    }
    throw error;
  }

  return { ok: true, workId: data.workId };
}
