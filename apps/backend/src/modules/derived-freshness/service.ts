import { inArray } from 'drizzle-orm';

import { contentAsset as contentAssetTable } from '@gloaming/db';
import { type DerivedFreshness, type DerivedState } from '@gloaming/shared/works';

import { db } from '@/db';
import { hashPartContent } from '@/modules/works/content-hash';

export type WorkPartSourceInput = {
  id: string;
  partId: string;
  title: string;
  body: string;
};

function audioStateForRows(rows: Array<{ status: string; contentHash: string }>, sourceHash: string): DerivedState {
  const ready = rows.filter((row) => row.status === 'ready');
  if (ready.length === 0) {
    return 'missing';
  }
  if (ready.some((row) => row.contentHash !== sourceHash)) {
    return 'stale';
  }
  return 'fresh';
}

export async function getWorksDerivedFreshness(works: WorkPartSourceInput[]): Promise<Map<string, DerivedFreshness>> {
  const result = new Map<string, DerivedFreshness>();
  if (works.length === 0) {
    return result;
  }

  const partIds = works.map((work) => work.partId);
  const audioRows = await db
    .select({
      partId: contentAssetTable.partId,
      status: contentAssetTable.status,
      contentHash: contentAssetTable.contentHash,
    })
    .from(contentAssetTable)
    .where(inArray(contentAssetTable.partId, partIds));

  const audioByPart = new Map<string, Array<{ status: string; contentHash: string }>>();
  for (const row of audioRows) {
    if (!row.partId) {
      continue;
    }
    const list = audioByPart.get(row.partId) ?? [];
    list.push({ status: row.status, contentHash: row.contentHash });
    audioByPart.set(row.partId, list);
  }

  for (const work of works) {
    const sourceHash = hashPartContent(work.title, work.body);
    result.set(work.id, {
      audio: audioStateForRows(audioByPart.get(work.partId) ?? [], sourceHash),
    });
  }

  return result;
}

export async function getWorkDerivedFreshness(work: WorkPartSourceInput): Promise<DerivedFreshness> {
  const map = await getWorksDerivedFreshness([work]);
  return map.get(work.id) ?? { audio: 'missing' };
}
