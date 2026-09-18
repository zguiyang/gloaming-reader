import { randomUUID } from 'node:crypto';

import { contentAsset as contentAssetTable, readingWork as readingWorkTable } from '@gloaming/db';
import type { CreateEpubWorkResult } from '@gloaming/shared/works';
import { EPUB_UPLOAD_MAX_BYTES } from '@gloaming/shared/works';

import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { JOB_CONTENT_PARSE } from '@/jobs/content-parse';
import { AppError, ValidationFailedError } from '@/lib/errors/app-error';
import { ERROR_CODES } from '@/lib/errors/codes';
import { rootLogger } from '@/lib/logger';
import { enqueue } from '@/lib/queue';
import { failWorkflowEnqueue, prepareWorkflowEnqueue } from '@/lib/workflow';
import { WORKFLOW_AUTO_CHAIN } from '@/lib/workflow-policy';
import type { UploadedFileMeta, UploadSpec } from '@/modules/uploads/service';
import {
  acquireUploadedObject,
  fileExtension,
  isValidContentHash,
  isZipFile,
  releaseUploadedObject,
} from '@/modules/uploads/service';

const ingestLogger = rootLogger.child({ module: 'WorksAdminEpubIngest' });

/** EPUB upload spec — MVP only accepts EPUB files (UI advertises TXT/PDF but they are rejected). */
export const EPUB_UPLOAD_SPEC: UploadSpec = {
  allowedExtensions: ['epub'],
  allowedMimeTypes: ['application/epub+zip', 'application/zip', 'application/octet-stream'],
  maxBytes: EPUB_UPLOAD_MAX_BYTES,
  validateContent: (body) => (isZipFile(body) ? null : 'EPUB 文件内容无效（非 ZIP 格式）'),
  keyBuilder: (contentHash) => `epub/${contentHash}.epub`,
};

function stripFileExtension(fileName: string): string {
  const extension = fileExtension(fileName);
  return extension ? fileName.slice(0, -(extension.length + 1)) : fileName;
}

async function enqueueParseWorkflowIfAutoChain(created: CreateEpubWorkResult): Promise<void> {
  if (!WORKFLOW_AUTO_CHAIN) {
    return;
  }
  const retryJobToken = String(created.originMeta.retryJobToken);
  const enqueueAttemptToken = randomUUID();
  if (!(await prepareWorkflowEnqueue(created.id, 'parse', 'processing', retryJobToken, enqueueAttemptToken))) {
    throw new AppError(500, ERROR_CODES.WORK.RESERVE_PARSE_FAILED);
  }
  try {
    await enqueue(
      JOB_CONTENT_PARSE,
      { workId: created.id, retryJobToken },
      { attempts: 2, jobId: `${JOB_CONTENT_PARSE}:${created.id}:${retryJobToken}` },
    );
  } catch (error) {
    await failWorkflowEnqueue(created.id, 'parse', retryJobToken, 'processing', enqueueAttemptToken, error);
    throw error;
  }
}

/**
 * Create the ReadingWork (draft, admin_epub) + ContentAsset (origin_file) rows
 * that reference an uploaded object. DB stores only the object storage key.
 * On failure the acquired reference is released (may garbage-collect the object).
 */
export async function insertEpubWorkAndAsset(input: {
  fileName: string;
  meta: UploadedFileMeta;
  reused: boolean;
  /** Internal test seam for deterministic rollback verification. */
  workId?: string;
  assetId?: string;
}): Promise<CreateEpubWorkResult> {
  const workId = input.workId ?? randomUUID();
  const title = stripFileExtension(input.fileName).slice(0, 200) || input.fileName;
  const retryJobToken = WORKFLOW_AUTO_CHAIN ? randomUUID() : undefined;
  const originMeta = {
    originalFileName: input.fileName,
    reused: input.reused,
    ...(retryJobToken ? { retryJobToken } : {}),
  };

  try {
    await db.transaction(async (tx) => {
      await tx.insert(readingWorkTable).values({
        id: workId,
        title,
        description: '',
        status: WORKFLOW_AUTO_CHAIN ? 'processing' : 'uploaded',
        originKind: 'admin_epub',
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
        meta: { size: input.meta.size, originalFileName: input.fileName, reused: input.reused },
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
    status: WORKFLOW_AUTO_CHAIN ? 'processing' : 'uploaded',
    originKind: 'admin_epub',
    originMeta,
    asset: {
      storageKey: input.meta.storageKey,
      mimeType: input.meta.mimeType,
      contentHash: input.meta.contentHash,
      size: input.meta.size,
    },
  };
}

/**
 * Admin EPUB upload (multipart) — dedupe-aware store, then create work + asset.
 * When the same file was uploaded before, the existing object is reused
 * (instant upload, `duplicated: true`) and no bytes are written.
 */
export async function createAdminEpubWork(input: {
  fileName: string;
  body: Buffer;
  contentType: string;
}): Promise<CreateEpubWorkResult> {
  const fileName = input.fileName.trim();
  if (!fileName) {
    throw new ValidationFailedError([
      { path: 'file', message: '请选择要上传的 EPUB 文件', code: ERROR_CODES.UPLOAD.FILE_REQUIRED },
    ]);
  }

  const result = await acquireUploadedObject({
    kind: 'file',
    fileName,
    body: input.body,
    contentType: input.contentType,
    spec: EPUB_UPLOAD_SPEC,
  });
  if (!result) {
    throw new AppError(500, ERROR_CODES.WORK.UPLOAD_EPUB_FAILED);
  }

  const created = await insertEpubWorkAndAsset({
    fileName,
    meta: result.meta,
    reused: result.duplicated,
  });
  await enqueueParseWorkflowIfAutoChain(created);
  return created;
}

/**
 * Instant upload (reuse) path — client already computed the file hash and asks
 * whether the object exists. Returns null when unknown (caller falls back to a
 * real upload); otherwise creates work + asset reusing the stored object.
 */
export async function reuseAdminEpubWork(input: {
  fileName: string;
  contentHash: string;
}): Promise<CreateEpubWorkResult | null> {
  const fileName = input.fileName.trim();
  if (!fileName) {
    throw new ValidationFailedError([
      { path: 'fileName', message: '请提供文件名', code: ERROR_CODES.UPLOAD.FILE_NAME_REQUIRED },
    ]);
  }
  if (!isValidContentHash(input.contentHash)) {
    throw new ValidationFailedError([
      { path: 'contentHash', message: '文件哈希无效', code: ERROR_CODES.UPLOAD.INVALID_HASH },
    ]);
  }

  const extension = fileExtension(fileName);
  if (!extension || !EPUB_UPLOAD_SPEC.allowedExtensions.includes(extension)) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.UPLOAD.EPUB_ONLY);
  }

  const result = await acquireUploadedObject({
    kind: 'hash',
    fileName,
    contentHash: input.contentHash,
    spec: EPUB_UPLOAD_SPEC,
  });
  if (!result) {
    return null;
  }

  const created = await insertEpubWorkAndAsset({ fileName, meta: result.meta, reused: true });
  await enqueueParseWorkflowIfAutoChain(created);
  return created;
}
