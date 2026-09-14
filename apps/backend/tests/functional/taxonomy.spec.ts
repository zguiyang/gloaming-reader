import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  category as categoryTable,
  readingWork as readingWorkTable,
  readingWorkCategory as readingWorkCategoryTable,
  readingWorkTag as readingWorkTagTable,
  source as sourceTable,
  tag as tagTable,
  user as userTable,
} from '@gloaming/db';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';
import type { LocalizedTextMap } from '@gloaming/shared/taxonomy';

import app from '@/app';
import { db } from '@/db';

const password = 'password123';

type TaxonomyRow = {
  id: string;
  name?: string;
  names?: LocalizedTextMap;
  usage: number;
  origin: string;
  matchRule: string | null;
};

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function cookieHeader(response: Response): string {
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
  if (getSetCookie?.length) {
    return getSetCookie.map((entry) => entry.split(';')[0]).join('; ');
  }
  const single = response.headers.get('set-cookie');
  return single ? single.split(';')[0]! : '';
}

async function signInAdmin(): Promise<string> {
  const email = uniqueEmail('tax-admin');
  const username = `taxadmin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password, name: 'tax-admin', username }),
  });
  await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.email, email));
  await db.update(userTable).set({ role: AUTH_ADMIN_ROLE }).where(eq(userTable.email, email));
  const login = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password }),
  });
  return cookieHeader(login);
}

function taxUrl(kind: string, path = ''): string {
  return `/api/admin/taxonomy/${kind}${path}`;
}

async function taxRequest(
  adminCookie: string,
  method: string,
  url: string,
  body?: unknown,
  acceptLanguage?: string,
): Promise<Response> {
  return app.request(url, {
    method,
    headers: {
      Cookie: adminCookie,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(acceptLanguage ? { 'Accept-Language': acceptLanguage } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe('taxonomy dimensions management', () => {
  let adminCookie = '';
  /** Works inserted directly to simulate usage — removed in afterAll. */
  const workIds: string[] = [];
  const tagIds: string[] = [];
  const categoryIds: string[] = [];
  const sourceIds: string[] = [];

  beforeAll(async () => {
    adminCookie = await signInAdmin();
  });

  afterAll(async () => {
    if (workIds.length > 0) {
      await db.delete(readingWorkTagTable).where(inArray(readingWorkTagTable.workId, workIds));
      await db.delete(readingWorkCategoryTable).where(inArray(readingWorkCategoryTable.workId, workIds));
      await db.delete(readingWorkTable).where(inArray(readingWorkTable.id, workIds));
    }
    if (tagIds.length > 0) {
      await db.delete(tagTable).where(inArray(tagTable.id, tagIds));
    }
    if (categoryIds.length > 0) {
      await db.delete(categoryTable).where(inArray(categoryTable.id, categoryIds));
    }
    if (sourceIds.length > 0) {
      await db.delete(sourceTable).where(inArray(sourceTable.id, sourceIds));
    }
  });

  async function createWork(title: string): Promise<string> {
    const [row] = await db
      .insert(readingWorkTable)
      .values({
        id: `tax-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        originKind: 'admin_text',
      })
      .returning({ id: readingWorkTable.id });
    workIds.push(row!.id);
    return row!.id;
  }

  async function createTag(name: string): Promise<string> {
    const [row] = await db
      .insert(tagTable)
      .values({ id: `tag-t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name, normalized: name })
      .returning({ id: tagTable.id });
    tagIds.push(row!.id);
    return row!.id;
  }

  it('creates and lists dimensions with usage counts', async () => {
    const create = await taxRequest(adminCookie, 'POST', taxUrl('tag'), { names: { 'en-US': 'Fantasy' } });
    expect(create.status).toBe(201);
    const tag = (await create.json()) as TaxonomyRow;
    expect(tag.names?.['en-US']).toBe('Fantasy');
    expect(tag.names).not.toHaveProperty('name');
    expect(tag.usage).toBe(0);
    expect(tag.origin).toBe('manual');
    tagIds.push(tag.id);

    const source = await taxRequest(adminCookie, 'POST', taxUrl('source'), {
      name: 'Test Press',
      matchRule: 'testpress.example',
    });
    expect(source.status).toBe(201);
    const sourceRow = (await source.json()) as TaxonomyRow;
    expect(sourceRow.name).toBe('Test Press');
    expect(sourceRow.matchRule).toBe('testpress.example');
    expect(sourceRow.origin).toBe('manual');
    sourceIds.push(sourceRow.id);

    const list = await taxRequest(adminCookie, 'GET', taxUrl('tag'));
    expect(list.status).toBe(200);
    const { items } = (await list.json()) as { items: TaxonomyRow[] };
    expect(items.some((item) => item.names?.['en-US'] === 'Fantasy')).toBe(true);

    const sourceList = await taxRequest(adminCookie, 'GET', taxUrl('source'));
    const sourceItems = (await sourceList.json()) as { items: TaxonomyRow[] };
    const found = sourceItems.items.find((item) => item.name === 'Test Press');
    expect(found?.matchRule).toBe('testpress.example');
  });

  it('returns bilingual names for tags/categories and a raw name for sources', async () => {
    const bilingual = { 'zh-CN': '科学', 'en-US': 'Science' };
    const tagCreate = await taxRequest(adminCookie, 'POST', taxUrl('tag'), { names: bilingual });
    const tag = (await tagCreate.json()) as TaxonomyRow;
    tagIds.push(tag.id);
    expect(tag.names).toEqual(bilingual);

    const categoryCreate = await taxRequest(adminCookie, 'POST', taxUrl('category'), { names: bilingual });
    const category = (await categoryCreate.json()) as TaxonomyRow;
    categoryIds.push(category.id);
    expect(category.names).toEqual(bilingual);
    expect(category).not.toHaveProperty('matchRule');

    const sourceCreate = await taxRequest(adminCookie, 'POST', taxUrl('source'), {
      name: 'Science Channel',
      matchRule: 'science.example',
    });
    const source = (await sourceCreate.json()) as TaxonomyRow;
    sourceIds.push(source.id);
    expect(source.name).toBe('Science Channel');
    expect(source).not.toHaveProperty('names');
    expect(source.matchRule).toBe('science.example');
  });

  it('lists all stored locales regardless of Accept-Language', async () => {
    const names = { 'zh-CN': '奇幻', 'en-US': 'Fantasy Locale' };
    const created = await taxRequest(adminCookie, 'POST', taxUrl('tag'), { names });
    const tag = (await created.json()) as TaxonomyRow;
    tagIds.push(tag.id);

    const zhList = await taxRequest(adminCookie, 'GET', taxUrl('tag'), undefined, 'zh-CN');
    const zhItems = ((await zhList.json()) as { items: TaxonomyRow[] }).items;
    const zhFound = zhItems.find((item) => item.id === tag.id);
    expect(zhFound?.names).toEqual(names);

    const enList = await taxRequest(adminCookie, 'GET', taxUrl('tag'), undefined, 'en-US');
    const enItems = ((await enList.json()) as { items: TaxonomyRow[] }).items;
    const enFound = enItems.find((item) => item.id === tag.id);
    expect(enFound?.names).toEqual(names);
  });

  it('accepts zh-CN-only and en-US-only creates', async () => {
    const zhOnly = await taxRequest(adminCookie, 'POST', taxUrl('tag'), { names: { 'zh-CN': '仅中文' } });
    const zhTag = (await zhOnly.json()) as TaxonomyRow;
    tagIds.push(zhTag.id);
    expect(zhTag.names).toEqual({ 'zh-CN': '仅中文' });
    expect(zhTag.names['en-US']).toBeUndefined();

    const enOnly = await taxRequest(adminCookie, 'POST', taxUrl('tag'), { names: { 'en-US': 'English Only' } });
    const enTag = (await enOnly.json()) as TaxonomyRow;
    tagIds.push(enTag.id);
    expect(enTag.names).toEqual({ 'en-US': 'English Only' });
    expect(enTag.names['zh-CN']).toBeUndefined();
  });

  it('rejects create without any supported locale name', async () => {
    const empty = await taxRequest(adminCookie, 'POST', taxUrl('tag'), { names: {} });
    expect(empty.status).toBe(400);

    const blank = await taxRequest(adminCookie, 'POST', taxUrl('tag'), { names: { 'zh-CN': '   ' } });
    expect(blank.status).toBe(400);

    const legacy = await taxRequest(adminCookie, 'POST', taxUrl('tag'), { name: 'Legacy' });
    expect(legacy.status).toBe(400);
  });

  it('merges locale names on update without dropping untouched locales', async () => {
    const created = await taxRequest(adminCookie, 'POST', taxUrl('tag'), {
      names: { 'zh-CN': '旧名', 'en-US': 'Old Name' },
    });
    const tag = (await created.json()) as TaxonomyRow;
    tagIds.push(tag.id);

    const zhUpdate = await taxRequest(adminCookie, 'PATCH', taxUrl('tag', `/${tag.id}`), {
      names: { 'zh-CN': '新名' },
    });
    expect(zhUpdate.status).toBe(200);
    expect(((await zhUpdate.json()) as TaxonomyRow).names).toEqual({
      'zh-CN': '新名',
      'en-US': 'Old Name',
    });

    const enUpdate = await taxRequest(adminCookie, 'PATCH', taxUrl('tag', `/${tag.id}`), {
      names: { 'en-US': 'New Name' },
    });
    expect(enUpdate.status).toBe(200);
    expect(((await enUpdate.json()) as TaxonomyRow).names).toEqual({
      'zh-CN': '新名',
      'en-US': 'New Name',
    });
  });

  it('rejects duplicate tags via normalized conflict', async () => {
    await taxRequest(adminCookie, 'POST', taxUrl('tag'), { names: { 'en-US': 'Mystery' } });
    const duplicate = await taxRequest(adminCookie, 'POST', taxUrl('tag'), { names: { 'en-US': 'mystery ' } });
    expect(duplicate.status).toBe(409);
  });

  it('renames a tag and recomputes normalized, rejecting conflicts', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const created = await taxRequest(adminCookie, 'POST', taxUrl('tag'), {
      names: { 'en-US': `Rename Old ${suffix}` },
    });
    const tag = (await created.json()) as TaxonomyRow;
    tagIds.push(tag.id);

    const renamed = await taxRequest(adminCookie, 'PATCH', taxUrl('tag', `/${tag.id}`), {
      names: { 'en-US': `Rename New ${suffix}` },
    });
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as TaxonomyRow).names['en-US']).toBe(`Rename New ${suffix}`);

    await taxRequest(adminCookie, 'POST', taxUrl('tag'), { names: { 'en-US': `Rename Taken ${suffix}` } });
    const conflict = await taxRequest(adminCookie, 'PATCH', taxUrl('tag', `/${tag.id}`), {
      names: { 'en-US': `rename taken ${suffix}` },
    });
    expect(conflict.status).toBe(409);
  });

  it('refuses to delete used tags/categories, allows unused ones', async () => {
    const workId = await createWork('Usage Work');
    const tagId = await createTag('Used Tag');
    await db.insert(readingWorkTagTable).values({ workId, tagId, provenance: 'manual' });

    const blocked = await taxRequest(adminCookie, 'DELETE', taxUrl('tag', `/${tagId}`));
    expect(blocked.status).toBe(409);

    const unused = await taxRequest(adminCookie, 'POST', taxUrl('tag'), { names: { 'en-US': 'Unused Tag' } });
    const unusedRow = (await unused.json()) as TaxonomyRow;
    tagIds.push(unusedRow.id);
    const deleted = await taxRequest(adminCookie, 'DELETE', taxUrl('tag', `/${unusedRow.id}`));
    expect(deleted.status).toBe(204);
  });

  it('never allows deleting sources', async () => {
    const created = await taxRequest(adminCookie, 'POST', taxUrl('source'), {
      name: 'Protected Source',
    });
    const source = (await created.json()) as TaxonomyRow;
    sourceIds.push(source.id);

    const blocked = await taxRequest(adminCookie, 'DELETE', taxUrl('source', `/${source.id}`));
    expect(blocked.status).toBe(403);

    const stillThere = await taxRequest(adminCookie, 'GET', taxUrl('source'));
    const items = (await stillThere.json()) as { items: TaxonomyRow[] };
    expect(items.items.some((item) => item.name === 'Protected Source')).toBe(true);
  });

  it('cleanup prunes unused tags/categories but keeps used ones', async () => {
    const workId = await createWork('Cleanup Work');
    const usedTagId = await createTag('Keep Tag');
    const unusedTagId = await createTag('Prune Tag');
    await db.insert(readingWorkTagTable).values({ workId, tagId: usedTagId, provenance: 'extracted' });

    const categoryCreate = await taxRequest(adminCookie, 'POST', taxUrl('category'), {
      names: { 'en-US': 'Keep Category' },
    });
    const usedCategory = (await categoryCreate.json()) as TaxonomyRow;
    categoryIds.push(usedCategory.id);
    await db.insert(readingWorkCategoryTable).values({ workId, categoryId: usedCategory.id, provenance: 'manual' });
    const unusedCategory = await taxRequest(adminCookie, 'POST', taxUrl('category'), {
      names: { 'en-US': 'Prune Category' },
    });
    const unusedCategoryRow = (await unusedCategory.json()) as TaxonomyRow;
    categoryIds.push(unusedCategoryRow.id);

    const tagCleanup = await taxRequest(adminCookie, 'POST', taxUrl('tag/cleanup'));
    expect(tagCleanup.status).toBe(200);
    const tagResult = (await tagCleanup.json()) as { deleted: number };
    expect(tagResult.deleted).toBeGreaterThanOrEqual(1);

    const categoryCleanup = await taxRequest(adminCookie, 'POST', taxUrl('category/cleanup'));
    const categoryResult = (await categoryCleanup.json()) as { deleted: number };
    expect(categoryResult.deleted).toBeGreaterThanOrEqual(1);

    const [keptTag] = await db.select({ id: tagTable.id }).from(tagTable).where(eq(tagTable.id, usedTagId));
    expect(keptTag?.id).toBe(usedTagId);
    const [prunedTag] = await db.select({ id: tagTable.id }).from(tagTable).where(eq(tagTable.id, unusedTagId));
    expect(prunedTag).toBeUndefined();
    const [keptCategory] = await db
      .select({ id: categoryTable.id })
      .from(categoryTable)
      .where(eq(categoryTable.id, usedCategory.id));
    expect(keptCategory?.id).toBe(usedCategory.id);
    const [prunedCategory] = await db
      .select({ id: categoryTable.id })
      .from(categoryTable)
      .where(eq(categoryTable.id, unusedCategoryRow.id));
    expect(prunedCategory).toBeUndefined();
  });

  it('rejects cleanup for sources', async () => {
    const response = await taxRequest(adminCookie, 'POST', taxUrl('source/cleanup'));
    expect(response.status).toBe(400);
  });
});
