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

import app from '@/app';
import { db } from '@/db';

const password = 'password123';

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

async function taxRequest(adminCookie: string, method: string, url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method,
    headers: { Cookie: adminCookie, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
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
    const create = await taxRequest(adminCookie, 'POST', taxUrl('tag'), { name: 'Fantasy' });
    expect(create.status).toBe(201);
    const tag = (await create.json()) as { id: string; name: string; usage: number; origin: string };
    expect(tag.name).toBe('Fantasy');
    expect(tag.usage).toBe(0);
    expect(tag.origin).toBe('manual');
    tagIds.push(tag.id);

    const source = await taxRequest(adminCookie, 'POST', taxUrl('source'), {
      name: 'Test Press',
      matchRule: 'testpress.example',
    });
    expect(source.status).toBe(201);
    const sourceRow = (await source.json()) as { id: string; matchRule: string; origin: string };
    expect(sourceRow.matchRule).toBe('testpress.example');
    expect(sourceRow.origin).toBe('manual');
    sourceIds.push(sourceRow.id);

    const list = await taxRequest(adminCookie, 'GET', taxUrl('tag'));
    expect(list.status).toBe(200);
    const { items } = (await list.json()) as { items: Array<{ name: string }> };
    expect(items.some((item) => item.name === 'Fantasy')).toBe(true);

    const sourceList = await taxRequest(adminCookie, 'GET', taxUrl('source'));
    const sourceItems = (await sourceList.json()) as { items: Array<{ name: string; matchRule: string | null }> };
    const found = sourceItems.items.find((item) => item.name === 'Test Press');
    expect(found?.matchRule).toBe('testpress.example');
  });

  it('rejects duplicate tags via normalized conflict', async () => {
    await taxRequest(adminCookie, 'POST', taxUrl('tag'), { name: 'Mystery' });
    const duplicate = await taxRequest(adminCookie, 'POST', taxUrl('tag'), { name: 'mystery ' });
    expect(duplicate.status).toBe(409);
  });

  it('renames a tag and recomputes normalized, rejecting conflicts', async () => {
    const created = await taxRequest(adminCookie, 'POST', taxUrl('tag'), { name: 'Old Name' });
    const tag = (await created.json()) as { id: string };
    tagIds.push(tag.id);

    const renamed = await taxRequest(adminCookie, 'PATCH', taxUrl('tag', `/${tag.id}`), { name: 'New Name' });
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as { name: string }).name).toBe('New Name');

    await taxRequest(adminCookie, 'POST', taxUrl('tag'), { name: 'Taken' });
    const conflict = await taxRequest(adminCookie, 'PATCH', taxUrl('tag', `/${tag.id}`), { name: 'taken' });
    expect(conflict.status).toBe(409);
  });

  it('refuses to delete used tags/categories, allows unused ones', async () => {
    const workId = await createWork('Usage Work');
    const tagId = await createTag('Used Tag');
    await db.insert(readingWorkTagTable).values({ workId, tagId, provenance: 'manual' });

    const blocked = await taxRequest(adminCookie, 'DELETE', taxUrl('tag', `/${tagId}`));
    expect(blocked.status).toBe(409);

    const unused = await taxRequest(adminCookie, 'POST', taxUrl('tag'), { name: 'Unused Tag' });
    const unusedRow = (await unused.json()) as { id: string };
    tagIds.push(unusedRow.id);
    const deleted = await taxRequest(adminCookie, 'DELETE', taxUrl('tag', `/${unusedRow.id}`));
    expect(deleted.status).toBe(204);
  });

  it('never allows deleting sources', async () => {
    const created = await taxRequest(adminCookie, 'POST', taxUrl('source'), { name: 'Protected Source' });
    const source = (await created.json()) as { id: string };
    sourceIds.push(source.id);

    const blocked = await taxRequest(adminCookie, 'DELETE', taxUrl('source', `/${source.id}`));
    expect(blocked.status).toBe(403);

    const stillThere = await taxRequest(adminCookie, 'GET', taxUrl('source'));
    const items = (await stillThere.json()) as { items: Array<{ name: string }> };
    expect(items.items.some((item) => item.name === 'Protected Source')).toBe(true);
  });

  it('cleanup prunes unused tags/categories but keeps used ones', async () => {
    const workId = await createWork('Cleanup Work');
    const usedTagId = await createTag('Keep Tag');
    const unusedTagId = await createTag('Prune Tag');
    await db.insert(readingWorkTagTable).values({ workId, tagId: usedTagId, provenance: 'extracted' });

    const categoryCreate = await taxRequest(adminCookie, 'POST', taxUrl('category'), { name: 'Keep Category' });
    const usedCategory = (await categoryCreate.json()) as { id: string };
    categoryIds.push(usedCategory.id);
    await db.insert(readingWorkCategoryTable).values({ workId, categoryId: usedCategory.id, provenance: 'manual' });
    const unusedCategory = await taxRequest(adminCookie, 'POST', taxUrl('category'), { name: 'Prune Category' });
    const unusedCategoryRow = (await unusedCategory.json()) as { id: string };
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
