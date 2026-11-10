import { eq, sql } from 'drizzle-orm';

import { uploadedObject as uploadedObjectTable } from '@gloaming/db';

import { db } from '@/infra/db';
import { deleteObject } from '@/infra/storage';

/**
 * Drop one reference to a registered object. When the last reference is
 * released, the object is deleted from storage. Unknown keys are ignored
 * (callers manage unregistered objects themselves).
 */
export async function releaseUploadedObject(storageKey: string): Promise<void> {
  const [row] = await db
    .select({ id: uploadedObjectTable.id })
    .from(uploadedObjectTable)
    .where(eq(uploadedObjectTable.storageKey, storageKey))
    .limit(1);
  if (!row) {
    return;
  }

  const [updated] = await db
    .update(uploadedObjectTable)
    .set({ refCount: sql`${uploadedObjectTable.refCount} - 1` })
    .where(eq(uploadedObjectTable.id, row.id))
    .returning({ refCount: uploadedObjectTable.refCount });

  const remaining = updated?.refCount ?? 0;
  if (remaining <= 0) {
    await db.delete(uploadedObjectTable).where(eq(uploadedObjectTable.id, row.id));
    await deleteObject(storageKey);
  }
}
