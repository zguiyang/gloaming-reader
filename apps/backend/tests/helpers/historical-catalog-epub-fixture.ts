import { randomUUID } from 'node:crypto';

import { contentAsset as contentAssetTable, readingWork as readingWorkTable } from '@gloaming/db';

import { storeEpubSource } from '@/domains/ingest/epub/work-upload';
import { db } from '@/infra/db';

/** Seed a Catalog EPUB work to exercise format-based parsing without a source identity. */
export async function createCatalogEpubIngestFixture(input: { fileName: string; bytes: Buffer }) {
  const source = await storeEpubSource({
    fileName: input.fileName,
    body: input.bytes,
    contentType: 'application/epub+zip',
  });
  if (!source) throw new Error('Historical EPUB fixture source was not stored');

  const id = randomUUID();
  const retryJobToken = randomUUID();
  await db.insert(readingWorkTable).values({
    id,
    title: input.fileName.replace(/\.epub$/i, ''),
    processingStatus: 'uploaded',
    originKind: null,
    visibility: 'catalog',
    ownerUserId: null,
    originMeta: {
      originalFileName: input.fileName,
      reused: source.duplicated,
      retryJobToken,
    },
  });
  await db.insert(contentAssetTable).values({
    id: randomUUID(),
    workId: id,
    kind: 'origin_file',
    status: 'ready',
    storageKey: source.meta.storageKey,
    mimeType: source.meta.mimeType,
    contentHash: source.meta.contentHash,
    meta: { size: source.meta.size, originalFileName: input.fileName, reused: source.duplicated },
  });
  return { id };
}
