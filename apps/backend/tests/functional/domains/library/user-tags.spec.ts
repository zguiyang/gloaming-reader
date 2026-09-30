import { randomUUID } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  readingWork as readingWorkTable,
  user as userTable,
  userLibraryItem as userLibraryItemTable,
  userTag as userTagTable,
  userWorkTag as userWorkTagTable,
} from '@gloaming/db';

import app from '@/app';
import { db } from '@/infra/db';

import { createCatalogWorkFixture } from '../../../helpers/catalog-work-fixture';

const password = 'password123';
const { sendAuthMailMock } = vi.hoisted(() => ({ sendAuthMailMock: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@/infra/auth/mail', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, sendAuthMail: sendAuthMailMock };
});

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function cookieHeader(response: Response): string {
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
  if (getSetCookie?.length) return getSetCookie.map((entry) => entry.split(';')[0]).join('; ');
  const single = response.headers.get('set-cookie');
  return single ? single.split(';')[0]! : '';
}

async function createSession() {
  const email = uniqueEmail('tag-user');
  const username = `tag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const signup = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password, name: 'tag user', username }),
  });
  expect(signup.status).toBe(200);
  await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.email, email));
  const login = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password }),
  });
  expect(login.status).toBe(200);
  const [user] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, email)).limit(1);
  return { email, cookie: cookieHeader(login), userId: user!.id };
}

async function createPersonalWork(userId: string, title: string) {
  const id = randomUUID();
  await db.insert(readingWorkTable).values({
    id,
    title,
    ownerUserId: userId,
    visibility: 'private',
    originKind: 'user_epub',
    processingStatus: 'ready',
  });
  return id;
}

describe('User Tag API', () => {
  const emails: string[] = [];
  const workIds: string[] = [];

  afterAll(async () => {
    if (workIds.length) await db.delete(readingWorkTable).where(inArray(readingWorkTable.id, workIds));
    for (const email of emails) await db.delete(userTable).where(eq(userTable.email, email));
  });

  it('keeps tag CRUD private, allows same normalized name per user, and rejects invalid names', async () => {
    const owner = await createSession();
    const other = await createSession();
    emails.push(owner.email, other.email);

    expect((await app.request('/api/library/tags')).status).toBe(401);
    const ownerCreate = await app.request('/api/library/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ name: ' English ' }),
    });
    expect(ownerCreate.status).toBe(201);
    const ownerTag = (await ownerCreate.json()) as { id: string; name: string };
    expect(ownerTag.name).toBe('English');

    const duplicate = await app.request('/api/library/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ name: ' english ' }),
    });
    expect(duplicate.status).toBe(409);
    expect((await app.request('/api/library/tags', { headers: { cookie: other.cookie } })).status).toBe(200);

    const otherCreate = await app.request('/api/library/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: other.cookie },
      body: JSON.stringify({ name: 'ENGLISH' }),
    });
    expect(otherCreate.status).toBe(201);
    const otherTag = (await otherCreate.json()) as { id: string };
    expect(otherTag.id).not.toBe(ownerTag.id);
    const otherTags = (await (
      await app.request('/api/library/tags', { headers: { cookie: other.cookie } })
    ).json()) as {
      id: string;
    }[];
    expect(otherTags.map((tag) => tag.id)).toEqual([otherTag.id]);

    expect(
      (
        await app.request(`/api/library/tags/${ownerTag.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', cookie: other.cookie },
          body: JSON.stringify({ name: 'Renamed' }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/library/tags/${ownerTag.id}`, {
          method: 'DELETE',
          headers: { cookie: other.cookie },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request('/api/library/tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: owner.cookie },
          body: JSON.stringify({ name: '   ' }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request('/api/library/tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: owner.cookie },
          body: JSON.stringify({ name: 'a'.repeat(81) }),
        })
      ).status,
    ).toBe(400);

    const renamed = await app.request(`/api/library/tags/${ownerTag.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ name: ' Favorite ' }),
    });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ id: ownerTag.id, name: 'Favorite' });
    const ownerTags = (await (
      await app.request('/api/library/tags', { headers: { cookie: owner.cookie } })
    ).json()) as {
      id: string;
      name: string;
    }[];
    expect(ownerTags).toEqual([{ id: ownerTag.id, name: 'Favorite', bookCount: 0 }]);
  });

  it('allows only owner Personal Works and saved Catalog Works, and enforces owner consistency in the database', async () => {
    const owner = await createSession();
    const other = await createSession();
    emails.push(owner.email, other.email);
    const ownWorkId = await createPersonalWork(owner.userId, 'Owner Personal Work');
    const otherWorkId = await createPersonalWork(other.userId, 'Other Personal Work');
    workIds.push(ownWorkId, otherWorkId);
    const catalog = await createCatalogWorkFixture({ title: 'Saved Catalog Work', body: 'A short chapter.' });
    const unsavedCatalog = await createCatalogWorkFixture({ title: 'Unsaved Catalog Work', body: 'Another chapter.' });
    workIds.push(catalog.id, unsavedCatalog.id);
    const [tag] = await db
      .insert(userTagTable)
      .values({ id: randomUUID(), userId: owner.userId, name: 'Reading', normalizedName: 'reading' })
      .returning({ id: userTagTable.id });

    expect(
      (
        await app.request(`/api/library/${ownWorkId}/tags/${tag!.id}`, {
          method: 'PUT',
          headers: { cookie: owner.cookie },
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await app.request(`/api/library/${otherWorkId}/tags/${tag!.id}`, {
          method: 'PUT',
          headers: { cookie: owner.cookie },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/library/${ownWorkId}/tags/${tag!.id}`, {
          method: 'PUT',
          headers: { cookie: other.cookie },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/library/${otherWorkId}/tags/${tag!.id}`, {
          method: 'PUT',
          headers: { cookie: other.cookie },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/library/${unsavedCatalog.id}/tags/${tag!.id}`, {
          method: 'PUT',
          headers: { cookie: owner.cookie },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/library/${catalog.id}`, {
          method: 'POST',
          headers: { cookie: owner.cookie },
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await app.request(`/api/library/${catalog.id}/tags/${tag!.id}`, {
          method: 'PUT',
          headers: { cookie: owner.cookie },
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await app.request(`/api/library/${catalog.id}/tags/${tag!.id}`, {
          method: 'PUT',
          headers: { cookie: owner.cookie },
        })
      ).status,
    ).toBe(204);
    expect(
      await db
        .select()
        .from(userWorkTagTable)
        .where(
          and(
            eq(userWorkTagTable.userId, owner.userId),
            eq(userWorkTagTable.workId, catalog.id),
            eq(userWorkTagTable.tagId, tag!.id),
          ),
        ),
    ).toHaveLength(1);
    expect(
      (
        await app.request(`/api/library/${ownWorkId}/tags/${tag!.id}`, {
          method: 'DELETE',
          headers: { cookie: owner.cookie },
        })
      ).status,
    ).toBe(204);
    expect(
      await db
        .select()
        .from(userWorkTagTable)
        .where(
          and(
            eq(userWorkTagTable.userId, owner.userId),
            eq(userWorkTagTable.workId, ownWorkId),
            eq(userWorkTagTable.tagId, tag!.id),
          ),
        ),
    ).toHaveLength(0);
    expect(
      (
        await app.request(`/api/library/${ownWorkId}/tags/${tag!.id}`, {
          method: 'PUT',
          headers: { cookie: owner.cookie },
        })
      ).status,
    ).toBe(204);

    await expect(
      db.insert(userWorkTagTable).values({ userId: other.userId, workId: ownWorkId, tagId: tag!.id }),
    ).rejects.toMatchObject({ cause: { code: '23503', constraint: 'user_work_tag_user_tag_fk' } });
    const tagDelete = await app.request(`/api/library/tags/${tag!.id}`, {
      method: 'DELETE',
      headers: { cookie: owner.cookie },
    });
    expect(tagDelete.status).toBe(204);
    expect(await db.select().from(userWorkTagTable).where(eq(userWorkTagTable.tagId, tag!.id))).toHaveLength(0);
    expect(await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, catalog.id))).toHaveLength(1);
    expect(
      await db
        .select()
        .from(userLibraryItemTable)
        .where(and(eq(userLibraryItemTable.userId, owner.userId), eq(userLibraryItemTable.workId, catalog.id))),
    ).toHaveLength(1);
  });

  it('cascades Work deletion to associations and user deletion to owned tags', async () => {
    const owner = await createSession();
    emails.push(owner.email);
    const workId = await createPersonalWork(owner.userId, 'Cascade Personal Work');
    workIds.push(workId);
    const [tag] = await db
      .insert(userTagTable)
      .values({ id: randomUUID(), userId: owner.userId, name: 'Cascade', normalizedName: 'cascade' })
      .returning({ id: userTagTable.id });
    await db.insert(userWorkTagTable).values({ userId: owner.userId, workId, tagId: tag!.id });

    await db.delete(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(await db.select().from(userWorkTagTable).where(eq(userWorkTagTable.workId, workId))).toHaveLength(0);
    workIds.splice(workIds.indexOf(workId), 1);

    const [userTagRow] = await db
      .select({ id: userTagTable.id })
      .from(userTagTable)
      .where(eq(userTagTable.id, tag!.id));
    expect(userTagRow).toBeDefined();
    await db.delete(userTable).where(eq(userTable.id, owner.userId));
    expect(await db.select().from(userTagTable).where(eq(userTagTable.id, tag!.id))).toHaveLength(0);
  });
});
