import { randomUUID } from 'node:crypto';

import { contentAsset as contentAssetTable, readingWork as readingWorkTable } from '@gloaming/db';
import type { WorkProcessingStatus, WorkVisibility } from '@gloaming/shared/works';
import { EPUB_UPLOAD_MAX_BYTES } from '@gloaming/shared/works';

import { type ContentParseLane, JOB_CONTENT_PARSE } from '@/application/jobs/content-parse';
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
import { enqueue, enqueueDiscoveryImport } from '@/infra/queue';
import { AppError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

const ingestLogger = rootLogger.child({ module: 'EpubWorkIngest' });

/** Caller-owned transaction; lets an entry point bundle the Work/asset insert into its own atomic unit. */
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Canonical MIME persisted on the origin asset; the parser registry selects by this exact value. */
const EPUB_ORIGIN_MIME_TYPE = 'application/epub+zip';

/** The one EPUB upload policy used by Personal and Catalog entry points. */
export const EPUB_UPLOAD_SPEC: UploadSpec = {
  allowedExtensions: ['epub'],
  allowedMimeTypes: [EPUB_ORIGIN_MIME_TYPE, 'application/zip', 'application/octet-stream'],
  maxBytes: EPUB_UPLOAD_MAX_BYTES,
  validateContent: (body) => (isZipFile(body) ? null : 'EPUB 文件内容无效（非 ZIP 格式）'),
  keyBuilder: (contentHash) => `epub/${contentHash}.epub`,
};

/**
 * Upload validation accepts generic ZIP/octet-stream MIME for valid EPUBs, but the parser
 * registry selects by exact contentType. Persist the canonical EPUB MIME on the origin asset
 * while leaving validation of the original accepted input untouched.
 */
export function canonicalEpubMimeType(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  return EPUB_UPLOAD_SPEC.allowedMimeTypes.includes(normalized) ? EPUB_ORIGIN_MIME_TYPE : normalized;
}

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

export type CreateEpubIngestWorkInput = {
  fileName: string;
  meta: UploadedFileMeta;
  reused: boolean;
  /** `null` for source-origin Catalog works that have no current provenance kind. */
  originKind: 'user_epub' | null;
  ownerUserId: string | null;
  visibility: WorkVisibility;
  processingStatus?: WorkProcessingStatus;
  retryJobToken?: string;
  workId?: string;
  assetId?: string;
  /** Source-supplied fallback metadata; the parser may overwrite it after ingest. */
  title?: string;
  author?: string;
  description?: string;
  language?: string;
};

/**
 * Shared persistence core; each entry point supplies its own ownership and visibility policy.
 *
 * When `executor` is provided the writes join the caller's transaction and the caller owns
 * failure cleanup (e.g. releasing the uploaded object after rollback). When it is omitted the
 * core opens its own transaction and releases the uploaded object on failure, preserving the
 * Personal upload behavior.
 */
export async function createEpubIngestWork(
  input: CreateEpubIngestWorkInput,
  executor?: DbTransaction,
): Promise<{ id: string; title: string; processingStatus: WorkProcessingStatus }> {
  const workId = input.workId ?? randomUUID();
  const fileName = sanitizeEpubFileName(input.fileName) || 'upload.epub';
  const fallbackTitle = fileName.replace(/\.epub$/i, '').slice(0, 200) || 'Untitled';
  const title = (input.title?.trim() || fallbackTitle).slice(0, 200) || 'Untitled';
  const processingStatus = input.processingStatus ?? 'uploaded';
  const originMeta = {
    originalFileName: fileName,
    reused: input.reused,
    ...(input.retryJobToken ? { retryJobToken: input.retryJobToken } : {}),
  };

  const insert = async (tx: DbTransaction) => {
    await tx.insert(readingWorkTable).values({
      id: workId,
      title,
      author: input.author ?? '',
      description: input.description ?? '',
      language: input.language?.trim() || 'en',
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
      mimeType: canonicalEpubMimeType(input.meta.mimeType),
      contentHash: input.meta.contentHash,
      meta: { size: input.meta.size, originalFileName: fileName, reused: input.reused },
    });
  };

  if (executor) {
    await insert(executor);
  } else {
    try {
      await db.transaction(insert);
    } catch (error) {
      try {
        await releaseUploadedObject(input.meta.storageKey);
      } catch (cleanupError) {
        ingestLogger.warn(
          { err: cleanupError, storageKey: input.meta.storageKey },
          'Failed to release upload reference',
        );
      }
      throw error;
    }
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
  processingLane?: ContentParseLane;
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
  const discoveryLane = input.processingLane === 'discovery';
  const enqueueJob = discoveryLane ? enqueueDiscoveryImport : enqueue;
  const data = {
    workId: input.workId,
    retryJobToken: input.retryJobToken,
    ...(discoveryLane ? { processingLane: 'discovery' as const } : {}),
  };
  try {
    await enqueueJob(JOB_CONTENT_PARSE, data, {
      attempts: 2,
      jobId: `${JOB_CONTENT_PARSE}-${input.workId}-${input.retryJobToken}`,
    });
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
