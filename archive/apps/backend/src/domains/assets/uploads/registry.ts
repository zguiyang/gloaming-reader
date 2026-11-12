import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';

import { uploadedObject as uploadedObjectTable } from '@gloaming/db';

import { db } from '@/infra/db';

export type UploadedFileMeta = {
  storageKey: string;
  mimeType: string;
  contentHash: string;
  size: number;
};

export async function findUploadedObjectByHash(contentHash: string): Promise<UploadedFileMeta | null> {
  const [row] = await db
    .select({
      storageKey: uploadedObjectTable.storageKey,
      mimeType: uploadedObjectTable.mimeType,
      size: uploadedObjectTable.size,
    })
    .from(uploadedObjectTable)
    .where(eq(uploadedObjectTable.contentHash, contentHash))
    .limit(1);
  if (!row) {
    return null;
  }
  return { storageKey: row.storageKey, mimeType: row.mimeType, contentHash, size: row.size };
}

export async function registerUploadedObject(input: {
  contentHash: string;
  storageKey: string;
  mimeType: string;
  size: number;
}): Promise<boolean> {
  const [registered] = await db
    .insert(uploadedObjectTable)
    .values({
      id: randomUUID(),
      contentHash: input.contentHash,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      size: input.size,
      refCount: 1,
    })
    .onConflictDoNothing()
    .returning({ id: uploadedObjectTable.id });
  return Boolean(registered);
}

/** Atomic increment of the dedup ref count for an existing object. */
export async function incrementUploadedObjectRef(contentHash: string): Promise<void> {
  await db
    .update(uploadedObjectTable)
    .set({ refCount: sql`${uploadedObjectTable.refCount} + 1` })
    .where(eq(uploadedObjectTable.contentHash, contentHash));
}
