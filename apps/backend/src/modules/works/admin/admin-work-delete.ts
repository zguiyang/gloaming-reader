import { and, eq, sql } from 'drizzle-orm';

import type { ContentAssetMeta } from '@gloaming/db';
import {
  contentAsset as contentAssetTable,
  conversation as conversationTable,
  readingPart as readingPartTable,
  readingWork as readingWorkTable,
  uploadedObject as uploadedObjectTable,
} from '@gloaming/db';

import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { AppError, NotFoundError } from '@/lib/errors/app-error';
import { ERROR_CODES } from '@/lib/errors/codes';
import { rootLogger } from '@/lib/logger';
import { collectReferencedStorageKeys } from '@/modules/asset-management/referenced-keys';
import { allAudioObjectKeysForLegacyCleanup } from '@/modules/content-assets/audio/keys';
import { deleteObject } from '@/modules/oss';
import { deleteBilingualCacheForPart } from '@/modules/translate/service';

const workLogger = rootLogger.child({ module: 'Works' });

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
