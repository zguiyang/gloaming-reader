import { randomUUID } from 'node:crypto';

import { readingPart as readingPartTable, readingWork as readingWorkTable } from '@gloaming/db';

import { db } from '@/infra/db';

/** Seed an existing Catalog Work directly for domain tests; this is not a runtime write path. */
export async function createCatalogWorkFixture(
  input: {
    id?: string;
    title?: string;
    body?: string | null;
    processingStatus?: string;
    publishedAt?: Date | null;
  } = {},
) {
  const id = input.id ?? randomUUID();
  const title = input.title ?? `Catalog fixture ${id}`;
  const body = input.body === undefined ? '<p>Fixture reading content.</p>' : input.body;
  await db.insert(readingWorkTable).values({
    id,
    title,
    author: '',
    description: '',
    language: 'en',
    processingStatus: input.processingStatus ?? 'ready',
    ownerUserId: null,
    visibility: 'catalog',
    publishedAt: input.publishedAt === undefined ? new Date() : input.publishedAt,
  });

  const parts = [];
  if (body !== null) {
    const partId = randomUUID();
    const [part] = await db
      .insert(readingPartTable)
      .values({
        id: partId,
        workId: id,
        sortOrder: 0,
        kind: 'chapter',
        title,
        body,
        meta: {},
      })
      .returning();
    if (!part) throw new Error('Catalog fixture part insert returned no row');
    parts.push(part);
  }

  return { id, title, parts };
}
