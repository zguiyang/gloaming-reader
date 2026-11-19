import { randomUUID } from 'node:crypto';

import { and, eq, ne, sql } from 'drizzle-orm';

import type { WorkProcessingStatus } from '@/shared/works';

import { contentAsset as contentAssetTable, readingWork as readingWorkTable } from '@/server/db';
import { releaseUploadedObject } from '@/server/domains/assets/uploads';
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
  /** Same bytes already owned by this user — no new shelf row was created. */
  alreadyExists: boolean;
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

/** Same bytes already owned by this user (non-failed) — avoid duplicate shelf rows. */
async function findOwnedActiveWorkByContentHash(
  userId: string,
  contentHash: string,
): Promise<PersonalEpubUploadResult | null> {
  const [row] = await db
    .select({
      id: readingWorkTable.id,
      title: readingWorkTable.title,
      processingStatus: readingWorkTable.processingStatus,
    })
    .from(contentAssetTable)
    .innerJoin(readingWorkTable, eq(readingWorkTable.id, contentAssetTable.workId))
    .where(
      and(
        eq(contentAssetTable.kind, 'origin_file'),
        eq(contentAssetTable.contentHash, contentHash),
        eq(readingWorkTable.ownerUserId, userId),
        eq(readingWorkTable.originKind, 'user_epub'),
        ne(readingWorkTable.processingStatus, 'failed'),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    processingStatus: row.processingStatus as WorkProcessingStatus,
    alreadyExists: true,
  };
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

  const existing = await findOwnedActiveWorkByContentHash(input.userId, source.meta.contentHash);
  if (existing) {
    // storeEpubSource bumped the object ref; undo it because no new Work was created.
    try {
      await releaseUploadedObject(source.meta.storageKey);
    } catch {
      // Best-effort; orphaned refs are recoverable via admin object scan.
    }
    return existing;
  }

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
  return {
    id: work.id,
    title: work.title,
    processingStatus: work.processingStatus,
    alreadyExists: false,
  };
}
