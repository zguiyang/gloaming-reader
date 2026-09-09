import { and, eq, inArray, or } from 'drizzle-orm';

import {
  contentAsset as contentAssetTable,
  readingPart as readingPartTable,
  readingWork as readingWorkTable,
  readingWorkCategory as readingWorkCategoryTable,
  readingWorkSource as readingWorkSourceTable,
  readingWorkTag as readingWorkTagTable,
} from '@gloaming/db';

import { db } from '@/db';
import { rootLogger } from '@/lib/logger';
import { workflowClaimWhere } from '@/lib/workflow';
import { deleteAudioAssetObjects } from '@/modules/content-assets/service';
import { deleteObject } from '@/modules/oss';

const ingestLogger = rootLogger.child({ module: 'IngestReset' });

type WorkRow = typeof readingWorkTable.$inferSelect;
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbClient = typeof db | DbTransaction;
type ParseClaim = {
  retryJobToken: string;
  attemptToken: string;
};
type DerivedAssetsForCleanup = {
  storageKeys: string[];
  audio: (typeof contentAssetTable.$inferSelect)[];
};

/** Remove derived asset rows and return their objects for post-commit cleanup. */
async function removeDerivedAssetRows(client: DbClient, workId: string): Promise<DerivedAssetsForCleanup> {
  const rows = await client
    .select({ id: contentAssetTable.id, storageKey: contentAssetTable.storageKey, kind: contentAssetTable.kind })
    .from(contentAssetTable)
    .where(and(eq(contentAssetTable.workId, workId), eq(contentAssetTable.kind, 'image')));
  // Collect every cover key: rows are deleted for the whole work, so a limit(1)
  // select would leave orphaned objects when multiple cover rows exist (re-parse tests).
  const cover = await client
    .select({ id: contentAssetTable.id, storageKey: contentAssetTable.storageKey })
    .from(contentAssetTable)
    .where(and(eq(contentAssetTable.workId, workId), eq(contentAssetTable.kind, 'cover')));

  if (rows.length > 0) {
    await client
      .delete(contentAssetTable)
      .where(and(eq(contentAssetTable.workId, workId), eq(contentAssetTable.kind, 'image')));
  }
  if (cover.length > 0) {
    await client
      .delete(contentAssetTable)
      .where(and(eq(contentAssetTable.workId, workId), eq(contentAssetTable.kind, 'cover')));
  }

  const audio = await client
    .select()
    .from(contentAssetTable)
    .where(
      and(
        eq(contentAssetTable.workId, workId),
        or(eq(contentAssetTable.kind, 'audio_us'), eq(contentAssetTable.kind, 'audio_uk')),
      ),
    );
  if (audio.length > 0) {
    await client.delete(contentAssetTable).where(
      inArray(
        contentAssetTable.id,
        audio.map((row) => row.id),
      ),
    );
  }

  return { storageKeys: [...rows, ...cover].map((row) => row.storageKey), audio };
}

/** Object deletion happens only after the asset-row transaction has committed. */
async function clearDerivedAssetObjects(workId: string, cleanup: DerivedAssetsForCleanup): Promise<void> {
  for (const storageKey of cleanup.storageKeys) {
    try {
      const [stillReferenced] = await db
        .select({ id: contentAssetTable.id })
        .from(contentAssetTable)
        .where(eq(contentAssetTable.storageKey, storageKey))
        .limit(1);
      if (!stillReferenced) {
        await deleteObject(storageKey);
      }
    } catch (error) {
      ingestLogger.warn({ err: error, workId, storageKey }, 'Failed to delete derived asset object');
    }
  }
  for (const asset of cleanup.audio) {
    try {
      await deleteAudioAssetObjects(asset);
    } catch (error) {
      ingestLogger.warn({ err: error, workId, assetId: asset.id }, 'Failed to delete derived audio objects');
    }
  }
}

/** AI-output reset: ai-provenance tag/category associations and ai-filled fields. */
export async function resetMetadataAiOutputs(work: WorkRow, client: DbClient = db): Promise<void> {
  await client
    .delete(readingWorkTagTable)
    .where(and(eq(readingWorkTagTable.workId, work.id), eq(readingWorkTagTable.provenance, 'ai')));
  await client
    .delete(readingWorkCategoryTable)
    .where(and(eq(readingWorkCategoryTable.workId, work.id), eq(readingWorkCategoryTable.provenance, 'ai')));
  if (work.descriptionProvenance === 'ai') {
    await client
      .update(readingWorkTable)
      .set({ description: '', descriptionProvenance: null })
      .where(eq(readingWorkTable.id, work.id));
  }
}

/** Re-parse reset: parts, derived assets, AI outputs, extracted junctions, and filled metadata fields. */
export async function resetParseStepOutputs(work: WorkRow, claim?: ParseClaim): Promise<void> {
  const reset = async (client: DbClient): Promise<DerivedAssetsForCleanup> => {
    const cleanup = await removeDerivedAssetRows(client, work.id);
    await client.delete(readingPartTable).where(eq(readingPartTable.workId, work.id));
    await resetMetadataAiOutputs(work, client);
    await client
      .delete(readingWorkTagTable)
      .where(and(eq(readingWorkTagTable.workId, work.id), eq(readingWorkTagTable.provenance, 'extracted')));
    await client
      .delete(readingWorkSourceTable)
      .where(and(eq(readingWorkSourceTable.workId, work.id), eq(readingWorkSourceTable.provenance, 'extracted')));
    await client
      .update(readingWorkTable)
      .set({
        title: '',
        author: '',
        description: '',
        coverAssetId: null,
        descriptionProvenance: null,
      })
      .where(eq(readingWorkTable.id, work.id));
    return cleanup;
  };

  if (!claim) {
    const cleanup = await db.transaction(reset);
    await clearDerivedAssetObjects(work.id, cleanup);
    return;
  }

  const cleanup = await db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ id: readingWorkTable.id })
      .from(readingWorkTable)
      .where(workflowClaimWhere(work.id, 'parse', claim.retryJobToken, claim.attemptToken))
      .for('update');
    if (!owned) {
      throw new Error('Parse workflow lease lost before reset');
    }
    return reset(tx);
  });
  await clearDerivedAssetObjects(work.id, cleanup);
}
