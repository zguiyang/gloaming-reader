import { randomUUID } from 'node:crypto';

import { and, eq, inArray, or, sql } from 'drizzle-orm';

import {
  contentAsset as contentAssetTable,
  type ContentAssetMeta,
  conversation as conversationTable,
  readingPart as readingPartTable,
  readingWork as readingWorkTable,
  uploadedObject as uploadedObjectTable,
} from '@gloaming/db';
import type { PersonalWorkUpdate } from '@gloaming/shared/works';

import {
  collectFormalKeysFromContentAssetRow,
  collectKeysFromOriginMeta,
  collectLegacySegmentKeysFromContentAssetRow,
  collectReferencedStorageKeys,
} from '@/domains/assets/management/referenced-keys';
import { acquireLockWithWait, releaseLock, startLockRenewal } from '@/infra/cache/lock';
import { db } from '@/infra/db';
import { enqueueCleanup } from '@/infra/queue';
import { deleteManyObjects } from '@/infra/storage';
import { HTTP_STATUS } from '@/shared/constants';
import { AppError, NotFoundError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

export const JOB_PERSONAL_WORK_CLEANUP = 'personal-work-cleanup';
const UPLOAD_DEDUPE_LOCK_PREFIX = 'gloaming:upload:dedupe:';
const UPLOAD_LOCK_TTL_SECONDS = 300;

export type PersonalWorkCleanupJobData = { keys: string[]; uploadContentHash: string | null };

/** Idempotently remove only keys that no current database row references. */
export async function processPersonalWorkCleanup(data: PersonalWorkCleanupJobData): Promise<{ ok: true }> {
  let lockKey: string | null = null;
  let token: string | null = null;
  let renewal: ReturnType<typeof startLockRenewal> | null = null;
  let lockLost = false;
  if (data.uploadContentHash) {
    lockKey = `${UPLOAD_DEDUPE_LOCK_PREFIX}${data.uploadContentHash}`;
    token = randomUUID();
    const locked = await acquireLockWithWait(lockKey, token, UPLOAD_LOCK_TTL_SECONDS, { maxWaitMs: 30_000 });
    if (!locked) throw new Error('Could not acquire upload dedupe lock for personal Work cleanup');
    renewal = startLockRenewal(lockKey, token, UPLOAD_LOCK_TTL_SECONDS, {
      onLeaseLost: () => {
        lockLost = true;
      },
    });
  }
  try {
    const referenced = await collectReferencedStorageKeys();
    const unreferenced = data.keys.filter((key) => !referenced.allReferencedKeys.has(key));
    const result = await deleteManyObjects(unreferenced);
    if (lockLost) throw new Error('Upload dedupe lock renewal failed during personal Work cleanup');
    if (result.failed.length > 0) throw new Error(`Failed to delete ${result.failed.length} personal Work objects`);
    return { ok: true };
  } finally {
    renewal?.stop();
    if (lockKey && token) await releaseLock(lockKey, token);
  }
}

export async function updatePersonalWork(userId: string, workId: string, patch: PersonalWorkUpdate) {
  const [updated] = await db
    .update(readingWorkTable)
    .set(patch)
    .where(
      and(
        eq(readingWorkTable.id, workId),
        eq(readingWorkTable.ownerUserId, userId),
        eq(readingWorkTable.processingStatus, 'ready'),
      ),
    )
    .returning({
      id: readingWorkTable.id,
      title: readingWorkTable.title,
      author: readingWorkTable.author,
      description: readingWorkTable.description,
    });
  if (!updated) throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
  return updated;
}

/** Delete an owned ready/failed Work, then queue reference-checked object cleanup. */
export async function deletePersonalWork(userId: string, workId: string): Promise<{ id: string; deleted: true }> {
  const [owned] = await db
    .select({ id: readingWorkTable.id })
    .from(readingWorkTable)
    .where(and(eq(readingWorkTable.id, workId), eq(readingWorkTable.ownerUserId, userId)))
    .limit(1);
  if (!owned) throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
  const [original] = await db
    .select({ contentHash: contentAssetTable.contentHash })
    .from(contentAssetTable)
    .where(and(eq(contentAssetTable.workId, workId), eq(contentAssetTable.kind, 'origin_file')))
    .limit(1);
  const uploadContentHash = original?.contentHash ?? null;
  const uploadLockKey = uploadContentHash ? `${UPLOAD_DEDUPE_LOCK_PREFIX}${uploadContentHash}` : null;
  const lockToken = randomUUID();
  let locked = false;
  let renewal: ReturnType<typeof startLockRenewal> | null = null;
  let lockLost = false;

  if (uploadLockKey) {
    locked = await acquireLockWithWait(uploadLockKey, lockToken, UPLOAD_LOCK_TTL_SECONDS, { maxWaitMs: 30_000 });
    if (!locked) throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.OSS.UNAVAILABLE);
    renewal = startLockRenewal(uploadLockKey, lockToken, UPLOAD_LOCK_TTL_SECONDS, {
      onLeaseLost: () => {
        lockLost = true;
      },
    });
  }

  try {
    if (lockLost) throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.OSS.UNAVAILABLE);
    const cleanup = await db.transaction(async (tx) => {
      const [work] = await tx
        .select({
          id: readingWorkTable.id,
          ownerUserId: readingWorkTable.ownerUserId,
          status: readingWorkTable.processingStatus,
          originMeta: readingWorkTable.originMeta,
        })
        .from(readingWorkTable)
        .where(and(eq(readingWorkTable.id, workId), eq(readingWorkTable.ownerUserId, userId)))
        .for('update')
        .limit(1);
      if (!work) throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
      if (work.status !== 'ready' && work.status !== 'failed') {
        throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.WORK.STATE_CHANGED);
      }

      const parts = await tx
        .select({ id: readingPartTable.id })
        .from(readingPartTable)
        .where(eq(readingPartTable.workId, workId));
      const partIds = parts.map(({ id }) => id);
      const assets = await tx
        .select({
          storageKey: contentAssetTable.storageKey,
          kind: contentAssetTable.kind,
          meta: contentAssetTable.meta,
        })
        .from(contentAssetTable)
        .where(
          partIds.length
            ? or(eq(contentAssetTable.workId, workId), inArray(contentAssetTable.partId, partIds))
            : eq(contentAssetTable.workId, workId),
        );
      const keys = new Set<string>(collectKeysFromOriginMeta(work.originMeta));
      for (const asset of assets) {
        for (const key of collectFormalKeysFromContentAssetRow({
          storageKey: asset.storageKey,
          kind: asset.kind,
          meta: asset.meta as ContentAssetMeta,
        }))
          keys.add(key);
        for (const key of collectLegacySegmentKeysFromContentAssetRow({ meta: asset.meta as ContentAssetMeta }))
          keys.add(key);
      }

      if (uploadContentHash) {
        if (lockLost) throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.OSS.UNAVAILABLE);
        const [uploaded] = await tx
          .update(uploadedObjectTable)
          .set({ refCount: sql`${uploadedObjectTable.refCount} - 1` })
          .where(and(eq(uploadedObjectTable.contentHash, uploadContentHash), sql`${uploadedObjectTable.refCount} > 0`))
          .returning({ id: uploadedObjectTable.id, refCount: uploadedObjectTable.refCount });
        if (uploaded?.refCount === 0) {
          await tx.delete(uploadedObjectTable).where(eq(uploadedObjectTable.id, uploaded.id));
        } else if (!uploaded) {
          throw new Error(`Missing upload registry reference for Work ${workId}`);
        }
      }

      await tx
        .delete(conversationTable)
        .where(and(eq(conversationTable.subjectType, 'reading_work'), eq(conversationTable.subjectId, workId)));
      await tx.delete(readingWorkTable).where(eq(readingWorkTable.id, workId));
      return { keys: [...keys], uploadContentHash };
    });

    if (cleanup.keys.length > 0) {
      try {
        await enqueueCleanup(JOB_PERSONAL_WORK_CLEANUP, cleanup, {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2_000 },
          jobId: `${JOB_PERSONAL_WORK_CLEANUP}-${workId}`,
        });
      } catch {
        renewal?.stop();
        renewal = null;
        if (locked && uploadLockKey) {
          await releaseLock(uploadLockKey, lockToken);
          locked = false;
        }
        await processPersonalWorkCleanup(cleanup);
      }
    }
    return { id: workId, deleted: true };
  } finally {
    renewal?.stop();
    if (locked && uploadLockKey) await releaseLock(uploadLockKey, lockToken);
  }
}
