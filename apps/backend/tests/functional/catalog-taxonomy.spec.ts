import { randomUUID } from 'node:crypto';

import { inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import {
  category as categoryTable,
  readingPart as readingPartTable,
  readingWork as readingWorkTable,
  readingWorkCategory as readingWorkCategoryTable,
  readingWorkTag as readingWorkTagTable,
  tag as tagTable,
} from '@gloaming/db';
import { catalogTaxonomyListDataSchema } from '@gloaming/shared/taxonomy';
import { catalogListDataSchema } from '@gloaming/shared/works';

import app from '@/app';
import { db } from '@/db';
import { normalizeTag } from '@/lib/text';

describe('public catalog taxonomy APIs', () => {
  const workIds: string[] = [];
  const tagIds: string[] = [];
  const categoryIds: string[] = [];

  afterAll(async () => {
    if (workIds.length > 0) {
      await db.delete(readingWorkTagTable).where(inArray(readingWorkTagTable.workId, workIds));
      await db.delete(readingWorkCategoryTable).where(inArray(readingWorkCategoryTable.workId, workIds));
      await db.delete(readingPartTable).where(inArray(readingPartTable.workId, workIds));
      await db.delete(readingWorkTable).where(inArray(readingWorkTable.id, workIds));
    }
    if (tagIds.length > 0) {
      await db.delete(tagTable).where(inArray(tagTable.id, tagIds));
    }
    if (categoryIds.length > 0) {
      await db.delete(categoryTable).where(inArray(categoryTable.id, categoryIds));
    }
  });

  async function seedCatalogWork(input: {
    title: string;
    visibility: 'catalog' | 'private';
    tagId?: string;
    categoryId?: string;
  }) {
    const workId = randomUUID();
    workIds.push(workId);

    await db.insert(readingWorkTable).values({
      id: workId,
      title: input.title,
      status: 'published',
      visibility: input.visibility,
      originKind: 'admin_text',
      publishedAt: new Date(),
    });
    await db.insert(readingPartTable).values({
      id: randomUUID(),
      workId,
      sortOrder: 0,
      kind: 'body',
      title: 'Body',
      body: '<p>Catalog taxonomy test body.</p>',
    });

    if (input.tagId) {
      await db.insert(readingWorkTagTable).values({ workId, tagId: input.tagId, provenance: 'manual' });
    }
    if (input.categoryId) {
      await db.insert(readingWorkCategoryTable).values({ workId, categoryId: input.categoryId, provenance: 'manual' });
    }
  }

  it('returns only tags used by published catalog-visible works', async () => {
    const visibleTagId = randomUUID();
    const hiddenTagId = randomUUID();
    tagIds.push(visibleTagId, hiddenTagId);

    await db.insert(tagTable).values([
      {
        id: visibleTagId,
        name: 'Visible Tag',
        normalized: normalizeTag('Visible Tag'),
        localizedNames: { 'en-US': 'Visible Tag', 'zh-CN': '可见标签' },
      },
      {
        id: hiddenTagId,
        name: 'Hidden Tag',
        normalized: normalizeTag('Hidden Tag'),
        localizedNames: { 'en-US': 'Hidden Tag' },
      },
    ]);

    await seedCatalogWork({ title: 'Visible Work', visibility: 'catalog', tagId: visibleTagId });
    await seedCatalogWork({ title: 'Private Work', visibility: 'private', tagId: hiddenTagId });

    const response = await app.request('/api/catalog/tags');
    expect(response.status).toBe(200);
    const body = catalogTaxonomyListDataSchema.parse(await response.json());

    const visibleTag = body.items.find((item) => item.id === visibleTagId);
    expect(visibleTag).toEqual({
      id: visibleTagId,
      names: { 'en-US': 'Visible Tag', 'zh-CN': '可见标签' },
    });

    const hiddenTag = body.items.find((item) => item.id === hiddenTagId);
    expect(hiddenTag).toBeUndefined();
  });

  it('returns only categories used by published catalog-visible works', async () => {
    const categoryId = randomUUID();
    categoryIds.push(categoryId);

    await db.insert(categoryTable).values({
      id: categoryId,
      name: 'Essays',
      normalized: normalizeTag('Essays'),
      localizedNames: { 'en-US': 'Essays', 'zh-CN': '随笔' },
    });
    await seedCatalogWork({ title: 'Essay Work', visibility: 'catalog', categoryId });

    const response = await app.request('/api/catalog/categories');
    expect(response.status).toBe(200);
    const body = catalogTaxonomyListDataSchema.parse(await response.json());
    expect(body.items).toEqual([
      {
        id: categoryId,
        names: { 'en-US': 'Essays', 'zh-CN': '随笔' },
      },
    ]);
  });

  it('filters catalog works by category AND any selected tag ids', async () => {
    const categoryId = randomUUID();
    const scienceTagId = randomUUID();
    const historyTagId = randomUUID();
    categoryIds.push(categoryId);
    tagIds.push(scienceTagId, historyTagId);

    await db.insert(categoryTable).values({
      id: categoryId,
      name: 'Nonfiction',
      normalized: normalizeTag('Nonfiction'),
      localizedNames: { 'en-US': 'Nonfiction' },
    });
    await db.insert(tagTable).values([
      {
        id: scienceTagId,
        name: 'Science',
        normalized: normalizeTag('Science'),
        localizedNames: { 'en-US': 'Science' },
      },
      {
        id: historyTagId,
        name: 'History',
        normalized: normalizeTag('History'),
        localizedNames: { 'en-US': 'History' },
      },
    ]);

    await seedCatalogWork({
      title: 'Science Match',
      visibility: 'catalog',
      categoryId,
      tagId: scienceTagId,
    });
    await seedCatalogWork({
      title: 'History Match',
      visibility: 'catalog',
      categoryId,
      tagId: historyTagId,
    });
    await seedCatalogWork({
      title: 'Wrong Category',
      visibility: 'catalog',
      tagId: scienceTagId,
    });

    const response = await app.request(`/api/catalog/works?category=${categoryId}&tag=${scienceTagId},${historyTagId}`);
    expect(response.status).toBe(200);
    const body = catalogListDataSchema.parse(await response.json());
    const titles = body.items.map((item) => item.title).sort();
    expect(titles).toEqual(['History Match', 'Science Match']);
    expect(body.items.every((item) => item.category?.id === categoryId)).toBe(true);
  });
});
