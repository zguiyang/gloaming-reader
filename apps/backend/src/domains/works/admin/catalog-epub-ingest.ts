import { randomUUID } from 'node:crypto';

import type { CreateEpubWorkResult } from '@gloaming/shared/works';

import { fileExtension, isValidContentHash, type UploadedFileMeta } from '@/domains/assets/uploads';
import {
  createEpubIngestWork,
  enqueueCoreEpubParse,
  EPUB_UPLOAD_SPEC,
  reuseEpubSource,
  sanitizeEpubFileName,
  storeEpubSource,
} from '@/domains/ingest/epub/work-upload';
import { WORKFLOW_AUTO_CHAIN } from '@/domains/works/lifecycle/policy';
import { HTTP_STATUS } from '@/shared/constants';
import { AppError, ValidationFailedError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

async function createCatalogEpubWorkRecord(input: {
  fileName: string;
  meta: UploadedFileMeta;
  reused: boolean;
  workId?: string;
  assetId?: string;
}): Promise<CreateEpubWorkResult> {
  const retryJobToken = WORKFLOW_AUTO_CHAIN ? randomUUID() : undefined;
  return createEpubIngestWork({
    ...input,
    originKind: 'admin_epub',
    ownerUserId: null,
    visibility: 'catalog',
    processingStatus: WORKFLOW_AUTO_CHAIN ? 'processing' : 'uploaded',
    retryJobToken,
  });
}

async function enqueueCatalogParseIfAutoChain(created: CreateEpubWorkResult): Promise<void> {
  if (!WORKFLOW_AUTO_CHAIN) return;
  await enqueueCoreEpubParse({
    workId: created.id,
    retryJobToken: String(created.originMeta.retryJobToken),
    currentStatus: created.processingStatus,
  });
}

/** Catalog upload keeps its independent review workflow; parse auto-chain remains policy-controlled. */
export async function createCatalogEpubWork(input: {
  fileName: string;
  body: Buffer;
  contentType: string;
}): Promise<CreateEpubWorkResult> {
  const fileName = sanitizeEpubFileName(input.fileName);
  if (!fileName) {
    throw new ValidationFailedError([
      { path: 'file', message: '请选择要上传的 EPUB 文件', code: ERROR_CODES.UPLOAD.FILE_REQUIRED },
    ]);
  }
  const result = await storeEpubSource({ ...input, fileName });
  if (!result) throw new AppError(500, ERROR_CODES.WORK.UPLOAD_EPUB_FAILED);
  const created = await createCatalogEpubWorkRecord({ fileName, meta: result.meta, reused: result.duplicated });
  await enqueueCatalogParseIfAutoChain(created);
  return created;
}

/** Admin-side hash reuse remains Catalog-only and never creates a compatibility upload route. */
export async function reuseCatalogEpubWork(input: {
  fileName: string;
  contentHash: string;
}): Promise<CreateEpubWorkResult | null> {
  const fileName = sanitizeEpubFileName(input.fileName);
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
  const result = await reuseEpubSource({ fileName, contentHash: input.contentHash });
  if (!result) return null;
  const created = await createCatalogEpubWorkRecord({ fileName, meta: result.meta, reused: true });
  await enqueueCatalogParseIfAutoChain(created);
  return created;
}
