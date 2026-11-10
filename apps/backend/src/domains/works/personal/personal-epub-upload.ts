import { randomUUID } from 'node:crypto';

import type { WorkProcessingStatus } from '@gloaming/shared/works';

import {
  createEpubIngestWork,
  enqueueCoreEpubParse,
  sanitizeEpubFileName,
  storeEpubSource,
} from '@/domains/ingest/epub/work-upload';
import { AppError, ValidationFailedError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

export type PersonalEpubUploadResult = {
  id: string;
  title: string;
  processingStatus: WorkProcessingStatus;
};

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

  await enqueueCoreEpubParse({ workId: work.id, retryJobToken, currentStatus: 'uploaded' });
  return { id: work.id, title: work.title, processingStatus: work.processingStatus };
}
