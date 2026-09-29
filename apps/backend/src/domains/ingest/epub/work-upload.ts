import { randomUUID } from 'node:crypto';

import { contentAsset as contentAssetTable, readingWork as readingWorkTable } from '@gloaming/db';
import type { WorkProcessingStatus, WorkVisibility } from '@gloaming/shared/works';
import { EPUB_UPLOAD_MAX_BYTES } from '@gloaming/shared/works';

import { JOB_CONTENT_PARSE } from '@/application/jobs/content-parse';
import {
  acquireUploadedObject,
  isZipFile,
  releaseUploadedObject,
  type UploadedFileMeta,
  type UploadSpec,
} from '@/domains/assets/uploads';
import { failWorkflowEnqueue, prepareWorkflowEnqueue } from '@/domains/works/lifecycle/workflow';
import { db } from '@/infra/db';
import { rootLogger } from '@/infra/logging/logger';
import { enqueue } from '@/infra/queue';
import { AppError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

const ingestLogger = rootLogger.child({ module: 'EpubWorkIngest' });

/** The one EPUB upload policy used by Personal and Catalog entry points. */
export const EPUB_UPLOAD_SPEC: UploadSpec = {
  allowedExtensions: ['epub'],
  allowedMimeTypes: ['application/epub+zip', 'application/zip', 'application/octet-stream'],
  maxBytes: EPUB_UPLOAD_MAX_BYTES,
  validateContent: (body) => (isZipFile(body) ? null : 'EPUB 文件内容无效（非 ZIP 格式）'),
  keyBuilder: (contentHash) => `epub/${contentHash}.epub`,
};

/** A client filename is metadata only; never let it choose an object-storage path. */
export function sanitizeEpubFileName(value: string): string {
  const leaf = value.trim().replaceAll('\\', '/').split('/').pop() ?? '';
  return [...leaf]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 0x1f && code !== 0x7f;
    })
    .join('')
    .trim()
    .slice(0, 255);
}

export async function storeEpubSource(input: { fileName: string; body: Buffer; contentType: string }) {
  return acquireUploadedObject({ kind: 'file', ...input, spec: EPUB_UPLOAD_SPEC });
}

/** Shared persistence core; each entry point supplies its own ownership and visibility policy. */
export async function createEpubIngestWork(input: {
  fileName: string;
  meta: UploadedFileMeta;
  reused: boolean;
  originKind: 'user_epub';
  ownerUserId: string | null;
  visibility: WorkVisibility;
  processingStatus?: WorkProcessingStatus;
  retryJobToken?: string;
  workId?: string;
  assetId?: string;
}): Promise<{ id: string; title: string; processingStatus: WorkProcessingStatus }> {
  const workId = input.workId ?? randomUUID();
  const fileName = sanitizeEpubFileName(input.fileName) || 'upload.epub';
  const title = fileName.replace(/\.epub$/i, '').slice(0, 200) || 'Untitled';
  const processingStatus = input.processingStatus ?? 'uploaded';
  const originMeta = {
    originalFileName: fileName,
    reused: input.reused,
    ...(input.retryJobToken ? { retryJobToken: input.retryJobToken } : {}),
  };

  try {
    await db.transaction(async (tx) => {
      await tx.insert(readingWorkTable).values({
        id: workId,
        title,
        description: '',
        processingStatus,
        originKind: input.originKind,
        ownerUserId: input.ownerUserId,
        visibility: input.visibility,
        originMeta,
        publishedAt: null,
      });
      await tx.insert(contentAssetTable).values({
        id: input.assetId ?? randomUUID(),
        workId,
        kind: 'origin_file',
        status: 'ready',
        storageKey: input.meta.storageKey,
        mimeType: input.meta.mimeType,
        contentHash: input.meta.contentHash,
        meta: { size: input.meta.size, originalFileName: fileName, reused: input.reused },
      });
    });
  } catch (error) {
    try {
      await releaseUploadedObject(input.meta.storageKey);
    } catch (cleanupError) {
      ingestLogger.warn({ err: cleanupError, storageKey: input.meta.storageKey }, 'Failed to release upload reference');
    }
    throw error;
  }

  return {
    id: workId,
    title,
    processingStatus,
  };
}

/** Queue the existing shared parser with the same lease and failure semantics used by workflow retries. */
export async function enqueueCoreEpubParse(input: {
  workId: string;
  retryJobToken: string;
  currentStatus: WorkProcessingStatus;
}): Promise<void> {
  const enqueueAttemptToken = randomUUID();
  if (
    !(await prepareWorkflowEnqueue(
      input.workId,
      'parse',
      input.currentStatus,
      input.retryJobToken,
      enqueueAttemptToken,
    ))
  ) {
    throw new AppError(500, ERROR_CODES.WORK.RESERVE_PARSE_FAILED);
  }
  try {
    await enqueue(
      JOB_CONTENT_PARSE,
      { workId: input.workId, retryJobToken: input.retryJobToken },
      { attempts: 2, jobId: `${JOB_CONTENT_PARSE}:${input.workId}:${input.retryJobToken}` },
    );
  } catch (error) {
    await failWorkflowEnqueue(
      input.workId,
      'parse',
      input.retryJobToken,
      input.currentStatus,
      enqueueAttemptToken,
      error,
    );
    throw error;
  }
}
