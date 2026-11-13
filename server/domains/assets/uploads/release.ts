import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import { uploadedObject as uploadedObjectTable } from '@/server/db';

import { UPLOAD_DEDUPE_LOCK_PREFIX } from '@/server/domains/assets/uploads/registry';
import { acquireLockWithWait, releaseLock, startLockRenewal } from '@/server/infra/cache/lock';
import { db } from '@/server/infra/db';
import { rootLogger } from '@/server/infra/logging/logger';
import { deleteObject } from '@/server/infra/storage';

const releaseLogger = rootLogger.child({ module: 'Uploads' });
const RELEASE_LOCK_TTL_SECONDS = 5 * 60;

/**
 * Drop one reference to a registered object. When the last reference is
 * released, the object is deleted from storage. Unknown keys are ignored
 * (callers manage unregistered objects themselves).
 *
 * The decrement runs under the same content-hash lock `acquireUploadedObject`
 * holds, otherwise a concurrent re-upload can observe the row between our
 * decrement and delete and end up referencing bytes we are about to remove.
 * The decrement itself is a single conditional `UPDATE`, so a stale `ref_count`
 * can never drive it below zero and never triggers a delete on its own.
 */
export async function releaseUploadedObject(storageKey: string): Promise<void> {
  const known = await findByStorageKey(storageKey);
  if (!known) {
    return;
  }

  const lockKey = `${UPLOAD_DEDUPE_LOCK_PREFIX}${known.contentHash}`;
  const lockToken = randomUUID();
  const locked = await acquireLockWithWait(lockKey, lockToken, RELEASE_LOCK_TTL_SECONDS, { maxWaitMs: 5_000 });
  if (!locked) {
    // Failing loudly beats silently deleting an object another upload just
    // claimed; callers already treat a failed release as non-fatal.
    throw new Error(`Could not acquire upload lock to release ${storageKey}`);
  }

  const renewal = startLockRenewal(lockKey, lockToken, RELEASE_LOCK_TTL_SECONDS, { maxDurationMs: 60_000 });
  try {
    const [updated] = await db
      .update(uploadedObjectTable)
      .set({ refCount: sql`${uploadedObjectTable.refCount} - 1` })
      .where(and(eq(uploadedObjectTable.id, known.id), sql`${uploadedObjectTable.refCount} > 0`))
      .returning({ refCount: uploadedObjectTable.refCount });

    // No row means either the registry entry is gone or it was already at zero;
    // in both cases this caller holds no live reference to remove.
    if (!updated || updated.refCount > 0) {
      return;
    }

    // Re-check the counter inside the delete so an acquire that slipped in
    // between the update and this statement keeps both its row and its bytes.
    const [deleted] = await db
      .delete(uploadedObjectTable)
      .where(and(eq(uploadedObjectTable.id, known.id), sql`${uploadedObjectTable.refCount} = 0`))
      .returning({ id: uploadedObjectTable.id });
    if (!deleted) {
      return;
    }
    await deleteObject(storageKey);
  } finally {
    renewal.stop();
    try {
      await releaseLock(lockKey, lockToken);
    } catch (error) {
      releaseLogger.warn({ err: error, lockKey }, 'Failed to release upload dedupe lock');
    }
  }
}

async function findByStorageKey(storageKey: string): Promise<{ id: string; contentHash: string } | null> {
  const [row] = await db
    .select({ id: uploadedObjectTable.id, contentHash: uploadedObjectTable.contentHash })
    .from(uploadedObjectTable)
    .where(eq(uploadedObjectTable.storageKey, storageKey))
    .limit(1);
  return row ?? null;
}
