import { randomUUID } from 'node:crypto';

import { UnrecoverableError } from 'bullmq';
import { eq } from 'drizzle-orm';

import { readingWork as readingWorkTable } from '@/server/db';

import { runContentParseWorkflow } from '@/server/application/commands/run-content-parse-workflow';
import { JOB_SOURCE_METADATA_ENRICH, type SourceMetadataEnrichJobData } from '@/jobs/source-metadata-enrich';
import { isEpubValidationError } from '@/server/domains/ingest/epub';
import {
  cleanSaveIntentFailureReason,
  failSaveIntentsForWorkParseFailure,
  fanOutReadySaveIntentsForWork,
  reviveFailedSaveIntentsForWorkParseRetry,
  type SaveIntentFailure,
} from '@/server/domains/library/save-intent';
import { db } from '@/server/infra/db';
import { rootLogger } from '@/server/infra/logging/logger';
import { enqueue } from '@/server/infra/queue';

export const JOB_CONTENT_PARSE = 'content-parse';
export type ContentParseLane = 'default' | 'discovery';

const parseLogger = rootLogger.child({ module: 'ContentParseJob' });

/** Map a recorded parse failure onto a short stable code plus a cleaned reason. */
function classifyParseFailure(error: unknown): SaveIntentFailure {
  if (isEpubValidationError(error)) {
    return { code: 'epub_invalid', reason: cleanSaveIntentFailureReason(error.message) };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: 'parse_failed', reason: cleanSaveIntentFailureReason(message) };
}

export type ContentParseJobData = {
  workId: string;
  retryJobToken: string;
  /** Missing context is a legacy/default parse and stays on the general workflow. */
  processingLane?: ContentParseLane;
};

export async function processContentParse(
  data: ContentParseJobData,
  attemptToken = randomUUID(),
): Promise<{ ok: true; workId: string }> {
  // A BullMQ retry re-parses a previously failed linked Source Work. Return its
  // failed save intents to pending before the attempt so a later success completes
  // them. Best-effort: never block the parse attempt on intent bookkeeping.
  try {
    await reviveFailedSaveIntentsForWorkParseRetry(data.workId);
  } catch (error) {
    parseLogger.warn({ err: error, workId: data.workId }, 'Failed to revive source record save intents');
  }
  try {
    if (!(await runContentParseWorkflow(data.workId, data.retryJobToken, attemptToken))) {
      return { ok: true, workId: data.workId };
    }
  } catch (error) {
    // Propagate a recorded parse failure to SourceRecord-linked save intents
    // before the error leaves the job. Best-effort so the parse error is preserved.
    try {
      await failSaveIntentsForWorkParseFailure(data.workId, classifyParseFailure(error));
    } catch (intentError) {
      parseLogger.warn({ err: intentError, workId: data.workId }, 'Failed to fail source record save intents');
    }
    // Invalid EPUB input is permanent; do not spend the queue's retry budget
    // on the same bytes. The workflow service has already recorded the failure.
    if (isEpubValidationError(error)) {
      throw new UnrecoverableError(error.message);
    }
    throw error;
  }
  // Parse finalized successfully for this Work. Fan out any pending SourceRecord
  // save intents now that the linked import is readable. A fan-out failure must
  // not mark a completed parse failed; a later Save re-reads and retries.
  try {
    await fanOutReadySaveIntentsForWork(data.workId);
  } catch (error) {
    parseLogger.warn({ err: error, workId: data.workId }, 'Failed to fan out source record save intents');
  }

  // Personal uploads: best-effort OPDS metadata fill after ready. Never blocks readability.
  try {
    const [work] = await db
      .select({ originKind: readingWorkTable.originKind })
      .from(readingWorkTable)
      .where(eq(readingWorkTable.id, data.workId))
      .limit(1);
    if (work?.originKind === 'user_epub') {
      const payload: SourceMetadataEnrichJobData = { workId: data.workId };
      await enqueue(JOB_SOURCE_METADATA_ENRICH, payload, {
        attempts: 2,
        jobId: `${JOB_SOURCE_METADATA_ENRICH}:${data.workId}`,
      });
    }
  } catch (error) {
    parseLogger.warn({ err: error, workId: data.workId }, 'Failed to enqueue source metadata enrich');
  }

  return { ok: true, workId: data.workId };
}
