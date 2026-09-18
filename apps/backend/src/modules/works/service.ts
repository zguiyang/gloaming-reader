import { randomUUID } from 'node:crypto';

import { and, eq, inArray, sql } from 'drizzle-orm';

import type { ContentAssetMeta } from '@gloaming/db';
import {
  category as categoryTable,
  contentAsset as contentAssetTable,
  conversation as conversationTable,
  readingPart as readingPartTable,
  readingWork as readingWorkTable,
  readingWorkCategory as readingWorkCategoryTable,
  readingWorkSource as readingWorkSourceTable,
  readingWorkTag as readingWorkTagTable,
  source as sourceTable,
  tag as tagTable,
  uploadedObject as uploadedObjectTable,
} from '@gloaming/db';
import type { AdminWork, CreateAdminTextWorkBody, CreateEpubWorkResult, UpdateWorkBody } from '@gloaming/shared/works';
import { EPUB_UPLOAD_MAX_BYTES } from '@gloaming/shared/works';

import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { JOB_CONTENT_PARSE } from '@/jobs/content-parse';
import { ERROR_CODES } from '@/lib/error-codes';
import { AppError, NotFoundError, ValidationFailedError } from '@/lib/errors';
import { rootLogger } from '@/lib/logger';
import { enqueue } from '@/lib/queue';
import { failWorkflowEnqueue, prepareWorkflowEnqueue } from '@/lib/workflow';
import { WORKFLOW_AUTO_CHAIN } from '@/lib/workflow-policy';
import { collectReferencedStorageKeys } from '@/modules/asset-management/service';
import { allAudioObjectKeysForLegacyCleanup } from '@/modules/content-assets/keys';
import { deleteObject } from '@/modules/oss';
import { computePartReadingStats, computeWorkReadingStats } from '@/modules/reading-stats/service';
import { deleteBilingualCacheForPart } from '@/modules/translate/service';
import type { UploadedFileMeta, UploadSpec } from '@/modules/uploads/service';
import {
  acquireUploadedObject,
  fileExtension,
  isValidContentHash,
  isZipFile,
  releaseUploadedObject,
} from '@/modules/uploads/service';
import { getAdminWork, toAdminWork } from '@/modules/works/admin-work-read';

const workLogger = rootLogger.child({ module: 'Works' });

/** Escape text for HTML body storage. */
function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Convert a plain-text body (textarea input) into paragraph HTML. */
function textToParagraphHtml(body: string): string {
  return body
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtmlText(paragraph)}</p>`)
    .join('\n');
}

/** Internal admin_text seed — creates one work + one body part (stored as HTML). */
export async function createAdminTextWork(input: CreateAdminTextWorkBody): Promise<AdminWork> {
  const workId = randomUUID();
  const partId = randomUUID();

  const [workRow] = await db
    .insert(readingWorkTable)
    .values({
      id: workId,
      title: input.title,
      description: '',
      status: 'ready',
      originKind: 'admin_text',
      publishedAt: null,
    })
    .returning();

  if (!workRow) {
    throw new AppError(500, ERROR_CODES.WORK.CREATE_FAILED);
  }

  const bodyHtml = textToParagraphHtml(input.body);
  const partStats = computePartReadingStats(bodyHtml);
  const workStats = computeWorkReadingStats([{ body: bodyHtml }], workRow.language);

  const [partRow] = await db
    .insert(readingPartTable)
    .values({
      id: partId,
      workId,
      sortOrder: 0,
      kind: 'body',
      title: input.title,
      body: bodyHtml,
      meta: { wordCount: partStats.wordCount },
    })
    .returning();

  if (!partRow) {
    throw new AppError(500, ERROR_CODES.WORK.CREATE_PART_FAILED);
  }

  const [updatedWork] = await db
    .update(readingWorkTable)
    .set({
      wordCount: workStats.wordCount,
      estimatedMinutes: workStats.estimatedMinutes,
      suggestedVocabSize: workStats.suggestedVocabSize,
      difficultyScore: workStats.difficultyScore,
      statsProvenance: workStats.statsProvenance,
    })
    .where(eq(readingWorkTable.id, workId))
    .returning();

  return toAdminWork(updatedWork ?? workRow, [partRow]);
}

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
      workLogger.warn({ err: cleanupError, storageKey: input.meta.storageKey }, 'Failed to release upload reference');
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
  if (WORKFLOW_AUTO_CHAIN) {
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
  if (WORKFLOW_AUTO_CHAIN) {
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
  return created;
}

export async function updateWork(id: string, input: UpdateWorkBody): Promise<AdminWork> {
  const [existing] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, id)).limit(1);
  if (!existing) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
  }

  const patch: Partial<typeof readingWorkTable.$inferInsert> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.author !== undefined) patch.author = input.author;
  if (input.description !== undefined) {
    patch.description = input.description;
    patch.descriptionProvenance = 'manual';
  }
  if (input.suggestedVocabSize !== undefined) {
    patch.suggestedVocabSize = input.suggestedVocabSize;
    patch.statsProvenance = 'manual';
  }
  if (input.difficultyScore !== undefined) {
    patch.difficultyScore = input.difficultyScore;
    patch.statsProvenance = 'manual';
  }

  if (
    input.tags === undefined &&
    input.sources === undefined &&
    input.category === undefined &&
    input.suggestedVocabSize === undefined &&
    input.difficultyScore === undefined &&
    Object.keys(patch).length === 0
  ) {
    return toAdminWork(existing);
  }

  await db.transaction(async (tx) => {
    if (input.tags !== undefined) {
      const tagIds = [...new Set(input.tags.map((tag) => tag.id))];
      if (tagIds.length > 0) {
        const existing = await tx.select({ id: tagTable.id }).from(tagTable).where(inArray(tagTable.id, tagIds));
        if (existing.length !== tagIds.length) {
          throw new NotFoundError(ERROR_CODES.NOT_FOUND.TAXONOMY_TAG);
        }
      }
      await tx
        .delete(readingWorkTagTable)
        .where(and(eq(readingWorkTagTable.workId, id), eq(readingWorkTagTable.provenance, 'manual')));
      if (tagIds.length > 0) {
        await tx
          .insert(readingWorkTagTable)
          .values(tagIds.map((tagId) => ({ workId: id, tagId, provenance: 'manual' as const })))
          .onConflictDoNothing();
      }
    }

    if (input.sources !== undefined) {
      const sourceIds = [...new Set(input.sources.map((source) => source.id))];
      if (sourceIds.length > 0) {
        const existing = await tx
          .select({ id: sourceTable.id })
          .from(sourceTable)
          .where(inArray(sourceTable.id, sourceIds));
        if (existing.length !== sourceIds.length) {
          throw new NotFoundError(ERROR_CODES.NOT_FOUND.TAXONOMY_SOURCE);
        }
      }
      await tx
        .delete(readingWorkSourceTable)
        .where(and(eq(readingWorkSourceTable.workId, id), eq(readingWorkSourceTable.provenance, 'manual')));
      if (sourceIds.length > 0) {
        await tx
          .insert(readingWorkSourceTable)
          .values(sourceIds.map((sourceId) => ({ workId: id, sourceId, provenance: 'manual' as const })))
          .onConflictDoNothing();
      }
    }

    // Category: single-select — null clears; stable id replaces every association (manual).
    if (input.category !== undefined) {
      await tx.delete(readingWorkCategoryTable).where(eq(readingWorkCategoryTable.workId, id));
      if (input.category !== null) {
        const [categoryRow] = await tx
          .select({ id: categoryTable.id })
          .from(categoryTable)
          .where(eq(categoryTable.id, input.category.id))
          .limit(1);
        if (!categoryRow) {
          throw new NotFoundError(ERROR_CODES.NOT_FOUND.TAXONOMY_CATEGORY);
        }
        await tx
          .insert(readingWorkCategoryTable)
          .values({ workId: id, categoryId: categoryRow.id, provenance: 'manual' })
          .onConflictDoNothing();
      }
    }

    if (Object.keys(patch).length > 0) {
      await tx.update(readingWorkTable).set(patch).where(eq(readingWorkTable.id, id));
    }
  });

  return getAdminWork(id);
}

type WorkExternalCleanup = {
  partIds: string[];
  storageKeys: string[];
};

/** Delete an object only when no committed DB row still references it. */
async function cleanupWorkStorageKey(workId: string, storageKey: string): Promise<void> {
  const referencedKeys = await collectReferencedStorageKeys();
  if (referencedKeys.allReferencedKeys.has(storageKey)) {
    return;
  }

  try {
    await deleteObject(storageKey);
  } catch (error) {
    // The DB no longer serves the work. Asset management's orphan scan can
    // safely discover and retry this external cleanup later.
    workLogger.warn({ err: error, workId, storageKey }, 'Failed to delete work storage object after DB commit');
  }
}

/**
 * Delete a work in two durable phases: remove DB facts and uploaded-object
 * references in one transaction, then perform best-effort external cleanup.
 * A failed object deletion is an orphan, not a healthy work resource, and is
 * recoverable by the existing asset-management scan/retry workflow.
 */
export async function deleteWork(id: string): Promise<void> {
  const cleanup = await db.transaction(async (tx): Promise<WorkExternalCleanup> => {
    const [existing] = await tx
      .select()
      .from(readingWorkTable)
      .where(eq(readingWorkTable.id, id))
      .for('update')
      .limit(1);
    if (!existing) {
      throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
    }
    if (existing.status === 'published') {
      throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.WORK.UNPUBLISH_FIRST);
    }

    const parts = await tx
      .select({ id: readingPartTable.id })
      .from(readingPartTable)
      .where(eq(readingPartTable.workId, id));
    const assetRows = await tx
      .select({ storageKey: contentAssetTable.storageKey, kind: contentAssetTable.kind, meta: contentAssetTable.meta })
      .from(contentAssetTable)
      .where(eq(contentAssetTable.workId, id));
    const storageKeys = new Set<string>();

    for (const asset of assetRows) {
      const keys = asset.kind.startsWith('audio_')
        ? allAudioObjectKeysForLegacyCleanup({ storageKey: asset.storageKey, meta: asset.meta as ContentAssetMeta })
        : [asset.storageKey, ...((asset.meta as ContentAssetMeta).objectKeys ?? [])];
      for (const key of keys) {
        if (key) storageKeys.add(key);
      }

      if (asset.kind !== 'origin_file') {
        continue;
      }

      const [uploaded] = await tx
        .select({ id: uploadedObjectTable.id, refCount: uploadedObjectTable.refCount })
        .from(uploadedObjectTable)
        .where(eq(uploadedObjectTable.storageKey, asset.storageKey))
        .for('update')
        .limit(1);
      if (!uploaded) {
        continue;
      }
      if (uploaded.refCount <= 1) {
        await tx.delete(uploadedObjectTable).where(eq(uploadedObjectTable.id, uploaded.id));
      } else {
        await tx
          .update(uploadedObjectTable)
          .set({ refCount: sql`${uploadedObjectTable.refCount} - 1` })
          .where(eq(uploadedObjectTable.id, uploaded.id));
        storageKeys.delete(asset.storageKey);
      }
    }

    await tx
      .delete(conversationTable)
      .where(and(eq(conversationTable.subjectType, 'reading_work'), eq(conversationTable.subjectId, id)));
    await tx.delete(readingWorkTable).where(eq(readingWorkTable.id, id));

    return { partIds: parts.map((part) => part.id), storageKeys: [...storageKeys] };
  });

  for (const partId of cleanup.partIds) {
    try {
      await deleteBilingualCacheForPart(partId);
    } catch (error) {
      workLogger.warn({ err: error, workId: id, partId }, 'Failed to delete bilingual cache after work commit');
    }
  }
  for (const storageKey of cleanup.storageKeys) {
    await cleanupWorkStorageKey(id, storageKey);
  }
}
