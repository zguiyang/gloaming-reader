import { randomUUID } from 'node:crypto';

import { inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import {
  readingPart as readingPartTable,
  readingWork as readingWorkTable,
  readingWorkTag as readingWorkTagTable,
  tag as tagTable,
} from '@gloaming/db';

import app from '@/app';
import { normalizeTag } from '@/domains/taxonomy';
import { db } from '@/infra/db';

describe('taxonomy SSOT projection', () => {
  const workIds: string[] = [];
  const tagIds: string[] = [];
  afterAll(async () => {
    if (workIds.length > 0) {
      await db.delete(readingWorkTagTable).where(inArray(readingWorkTagTable.workId, workIds));
      await db.delete(readingPartTable).where(inArray(readingPartTable.workId, workIds));
      await db.delete(readingWorkTable).where(inArray(readingWorkTable.id, workIds));
    }
    if (tagIds.length > 0) {
      await db.delete(tagTable).where(inArray(tagTable.id, tagIds));
    }
  });

  it('filters published catalog by stable tag id', async () => {
    const tagId = randomUUID();
    const workId = randomUUID();
    workIds.push(workId);
    tagIds.push(tagId);

    await db.insert(readingWorkTable).values({
      id: workId,
      title: 'Catalog SSOT-Unique-Tag',
      processingStatus: 'ready',
      visibility: 'catalog',
      originKind: 'admin_text',
      publishedAt: new Date(),
    });
    await db.insert(readingPartTable).values({
      id: randomUUID(),
      workId,
      sortOrder: 0,
      kind: 'body',
      title: 'Body',
      body: '<p>Enough body text for publish checks.</p>',
    });
    await db.insert(tagTable).values({
      id: tagId,
      name: 'SSOT-Unique-Tag',
      normalized: normalizeTag('SSOT-Unique-Tag'),
    });
    await db.insert(readingWorkTagTable).values({ workId, tagId, provenance: 'manual' });

    const response = await app.request(`/api/catalog/works?tag=${tagId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Array<{ title: string }> };
    expect(body.items.some((item) => item.title === 'Catalog SSOT-Unique-Tag')).toBe(true);
  });
});
