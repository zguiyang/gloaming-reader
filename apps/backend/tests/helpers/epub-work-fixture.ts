import { randomUUID } from 'node:crypto';

import { createEpubIngestWork, storeEpubSource } from '@/domains/ingest/epub/work-upload';

/** Create an unqueued Personal EPUB Work for parser and ingest-domain tests. */
export async function createEpubWorkFixture(input: { userId: string; bytes: Buffer; fileName?: string }) {
  const fileName = input.fileName ?? 'fixture.epub';
  const source = await storeEpubSource({
    fileName,
    body: input.bytes,
    contentType: 'application/epub+zip',
  });
  if (!source) throw new Error('EPUB fixture source was not stored');
  return createEpubIngestWork({
    fileName,
    meta: source.meta,
    reused: source.duplicated,
    originKind: 'user_epub',
    ownerUserId: input.userId,
    visibility: 'private',
    processingStatus: 'uploaded',
    retryJobToken: randomUUID(),
  });
}
