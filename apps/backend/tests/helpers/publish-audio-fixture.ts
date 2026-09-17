import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { contentAsset as contentAssetTable, readingPart as readingPartTable } from '@gloaming/db';
import { audioKindForRole } from '@gloaming/shared/content-assets';

import { db } from '@/db';
import { partAudioObjectKey } from '@/modules/content-assets/keys';
import { hashPartAudioContent } from '@/modules/works/content-hash';

/** Insert ready default-role (US) audio rows so publishWork audio gate passes in functional tests. */
export async function seedReadyDefaultAudioForWork(workId: string): Promise<void> {
  const parts = await db.select().from(readingPartTable).where(eq(readingPartTable.workId, workId));
  for (const part of parts) {
    const contentHash = hashPartAudioContent(part.body);
    const kind = audioKindForRole('us');
    await db.insert(contentAssetTable).values({
      id: randomUUID(),
      workId,
      partId: part.id,
      kind,
      status: 'ready',
      contentHash,
      storageKey: partAudioObjectKey(part.id, kind, contentHash),
      mimeType: 'audio/mpeg',
      meta: {},
    });
  }
}
