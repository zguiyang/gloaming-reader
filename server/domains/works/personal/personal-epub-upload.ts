import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import type { WorkProcessingStatus } from '@/shared/works';

import { readingWork as readingWorkTable } from '@/server/db';
import {
  createEpubIngestWork,
  enqueueCoreEpubParse,
  sanitizeEpubFileName,
  storeEpubSource,
} from '@/server/domains/ingest/epub/work-upload';
import { db } from '@/server/infra/db';
import { AppError, ValidationFailedError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';

export type PersonalEpubUploadResult = {
  id: string;
  title: string;
  processingStatus: WorkProcessingStatus;
};

/**
 * If enqueue never reserved a lease (or failWorkflowEnqueue could not match),
 * the Work would otherwise sit in `uploaded` forever. Mark it failed-at-parse so
 * the stalled recovery sweep / a later retry path can see a terminal state.
 */
async function failOrphanUploadedPersonalParse(workId: string, retryJobToken: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const failedAt = new Date().toISOString();
  await db
    .update(readingWorkTable)
    .set({
      processingStatus: 'failed',
      originMeta: sql`(${readingWorkTable.originMeta} - 'workflowEnqueueStep' - 'workflowEnqueueAttempt' - 'workflowEnqueueLeaseExpiresAt') || ${JSON.stringify(
        {
          failedStep: 'parse',
          lastError: message,
          failedAt,
        },
      )}::jsonb`,
    })
    .where(
      and(
        eq(readingWorkTable.id, workId),
        eq(readingWorkTable.processingStatus, 'uploaded'),
        sql`${readingWorkTable.originMeta}->>'retryJobToken' = ${retryJobToken}`,
      ),
    );
}

/** Personal policy is applied here; parsing and durable ingest stay in the shared core. */
export async function createPersonalEpubWork(input: {
  userId: string;
  fileName: string;
  body: Buffer;
  contentType: string;
}): Promise<PersonalEpubUploadResult> {
  const fileName = sanitizeEpubFileName(input.fileName);
  if (!fileName) {
    throw new ValidationFailedError([
      { path: 'file', message: '请选择要上传的 EPUB 文件', code: ERROR_CODES.UPLOAD.FILE_REQUIRED },
    ]);
  }
  const source = await storeEpubSource({ fileName, body: input.body, contentType: input.contentType });
  if (!source) throw new AppError(500, ERROR_CODES.WORK.UPLOAD_EPUB_FAILED);

  const retryJobToken = randomUUID();
  const work = await createEpubIngestWork({
    fileName,
    meta: source.meta,
    reused: source.duplicated,
    originKind: 'user_epub',
    ownerUserId: input.userId,
    visibility: 'private',
    processingStatus: 'uploaded',
    retryJobToken,
  });

  try {
    await enqueueCoreEpubParse({ workId: work.id, retryJobToken, currentStatus: 'uploaded' });
  } catch (error) {
    await failOrphanUploadedPersonalParse(work.id, retryJobToken, error);
    throw error;
  }
  return { id: work.id, title: work.title, processingStatus: work.processingStatus };
}
