import { randomUUID } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  readingState as readingStateTable,
  readingWork as readingWorkTable,
  user as userTable,
  userLibraryItem as userLibraryItemTable,
  userTag as userTagTable,
  userWorkTag as userWorkTagTable,
} from '@gloaming/db';

import app from '@/app';
import { db } from '@/infra/db';
import { AppError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

import { createCatalogWorkFixture } from '../../../helpers/catalog-work-fixture';

const password = 'password123';
const { sendAuthMailMock } = vi.hoisted(() => ({ sendAuthMailMock: vi.fn().mockResolvedValue(undefined) }));
const { invokeAiMock } = vi.hoisted(() => ({ invokeAiMock: vi.fn() }));

vi.mock('@/infra/auth/mail', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, sendAuthMail: sendAuthMailMock };
});

vi.mock('@/domains/ai', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, invokeAi: invokeAiMock };
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

  it('creates in any supported locale, completes translations through the user-scoped AI mock, and stays one tag', async () => {
    const owner = await createSession();
    emails.push(owner.email);
    invokeAiMock.mockReset().mockResolvedValue({
      content: { translations: [{ locale: 'zh-CN', name: '儿童文学' }] },
      model: { rowId: 'mock-model', label: 'Mock', modelId: 'mock' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });

    const create = await app.request('/api/library/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ name: 'Children’s Literature', locale: 'en-US' }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as {
      id: string;
      name: string;
      sourceLocale: string;
      localizedNames: Record<string, string>;
    };
    expect(created).toMatchObject({
      name: 'Children’s Literature',
      sourceLocale: 'en-US',
      localizedNames: { 'en-US': 'Children’s Literature' },
    });

    const complete = await app.request(`/api/library/tags/${created.id}/translations/complete`, {
      method: 'POST',
      headers: { cookie: owner.cookie },
    });
    expect(complete.status).toBe(200);
    expect(await complete.json()).toMatchObject({
      status: 'completed',
      tag: { id: created.id, localizedNames: { 'en-US': 'Children’s Literature', 'zh-CN': '儿童文学' } },
    });
    expect(invokeAiMock).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'translate',
        userId: owner.userId,
        ref: { type: 'user_tag', id: created.id },
      }),
    );

    const repeat = await app.request(`/api/library/tags/${created.id}/translations/complete`, {
      method: 'POST',
      headers: { cookie: owner.cookie },
    });
    expect(repeat.status).toBe(200);
    expect(invokeAiMock).toHaveBeenCalledTimes(1);
    const rows = await db.select().from(userTagTable).where(eq(userTagTable.userId, owner.userId));
    expect(rows).toHaveLength(1);
  });

  it('accepts a confirmed same-spelling translation and keeps an omitted locale missing', async () => {
    const owner = await createSession();
    emails.push(owner.email);

    const create = async (name: string) => {
      const response = await app.request('/api/library/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({ name, locale: 'en-US' }),
      });
      expect(response.status).toBe(201);
      return (await response.json()) as { id: string };
    };

    const confirmed = await create('AI');
    invokeAiMock.mockReset().mockResolvedValueOnce({
      content: { translations: [{ locale: 'zh-CN', name: 'AI' }] },
      model: { rowId: 'mock-model', label: 'Mock', modelId: 'mock' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
    const confirmedResult = await app.request(`/api/library/tags/${confirmed.id}/translations/complete`, {
      method: 'POST',
      headers: { cookie: owner.cookie },
    });
    expect(await confirmedResult.json()).toMatchObject({
      status: 'completed',
      tag: { localizedNames: { 'en-US': 'AI', 'zh-CN': 'AI' } },
    });

    const omitted = await create('Python');
    invokeAiMock.mockReset().mockResolvedValueOnce({
      content: { translations: [] },
      model: { rowId: 'mock-model', label: 'Mock', modelId: 'mock' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
    const omittedResult = await app.request(`/api/library/tags/${omitted.id}/translations/complete`, {
      method: 'POST',
      headers: { cookie: owner.cookie },
    });
    expect(await omittedResult.json()).toMatchObject({
      status: 'incomplete',
      tag: { localizedNames: { 'en-US': 'Python' } },
    });
  });

  it('keeps the original name when the provider is unavailable or translation fails', async () => {
    const owner = await createSession();
    emails.push(owner.email);
    const createdResponse = await app.request('/api/library/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ name: '英语学习2', locale: 'zh-CN' }),
    });
    const created = (await createdResponse.json()) as { id: string };

    invokeAiMock
      .mockReset()
      .mockRejectedValueOnce(new AppError(503, ERROR_CODES.AI.MODEL_NOT_CONFIGURED, { label: 'Translate' }));
    const unavailable = await app.request(`/api/library/tags/${created.id}/translations/complete`, {
      method: 'POST',
      headers: { cookie: owner.cookie },
    });
    expect(await unavailable.json()).toMatchObject({ status: 'provider_unavailable', tag: { name: '英语学习2' } });

    invokeAiMock.mockReset().mockRejectedValueOnce(new Error('mock translation failure'));
    const failed = await app.request(`/api/library/tags/${created.id}/translations/complete`, {
      method: 'POST',
      headers: { cookie: owner.cookie },
    });
    expect(await failed.json()).toMatchObject({
      status: 'incomplete',
      tag: { id: created.id, name: '英语学习2', localizedNames: { 'zh-CN': '英语学习2' } },
    });
    expect(await db.select().from(userTagTable).where(eq(userTagTable.id, created.id))).toHaveLength(1);
  });

  it('does not overwrite a translation edited while an AI result is in flight', async () => {
    const owner = await createSession();
    emails.push(owner.email);
    const createdResponse = await app.request('/api/library/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ name: '儿童文学', locale: 'zh-CN' }),
    });
    const created = (await createdResponse.json()) as { id: string };

    let resolveAi!: (result: unknown) => void;
    invokeAiMock.mockReset().mockReturnValueOnce(
      new Promise((resolve) => {
        resolveAi = resolve;
      }),
    );
    const completionPromise = app.request(`/api/library/tags/${created.id}/translations/complete`, {
      method: 'POST',
      headers: { cookie: owner.cookie },
    });
    await vi.waitFor(() => expect(invokeAiMock).toHaveBeenCalledTimes(1));

    const edit = await app.request(`/api/library/tags/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ name: 'Children’s books', locale: 'en-US' }),
    });
    expect(edit.status).toBe(200);
    resolveAi({
      content: { translations: [{ locale: 'en-US', name: 'Children’s Literature' }] },
      model: { rowId: 'mock-model', label: 'Mock', modelId: 'mock' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
    const completion = await completionPromise;
    expect(await completion.json()).toMatchObject({
      status: 'completed',
      tag: {
        id: created.id,
        localizedNames: { 'zh-CN': '儿童文学', 'en-US': 'Children’s books' },
        userEditedLocales: ['zh-CN', 'en-US'],
      },
    });
  });

  it('does not restore a stale translation after the source name changes during AI completion', async () => {
    const owner = await createSession();
    emails.push(owner.email);
    const createdResponse = await app.request('/api/library/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ name: '英语学习', locale: 'zh-CN' }),
    });
    const created = (await createdResponse.json()) as { id: string };

    let resolveAi!: (result: unknown) => void;
    invokeAiMock.mockReset().mockReturnValueOnce(
      new Promise((resolve) => {
        resolveAi = resolve;
      }),
    );
    const completionPromise = app.request(`/api/library/tags/${created.id}/translations/complete`, {
      method: 'POST',
      headers: { cookie: owner.cookie },
    });
    await vi.waitFor(() => expect(invokeAiMock).toHaveBeenCalledTimes(1));

    const sourceRename = await app.request(`/api/library/tags/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ name: '历史', locale: 'zh-CN' }),
    });
    expect(sourceRename.status).toBe(200);

    resolveAi({
      content: { translations: [{ locale: 'en-US', name: 'English Learning' }] },
      model: { rowId: 'mock-model', label: 'Mock', modelId: 'mock' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
    const completion = await completionPromise;
    expect(await completion.json()).toMatchObject({
      status: 'incomplete',
      tag: { id: created.id, name: '历史', localizedNames: { 'zh-CN': '历史' } },
    });
  });

  it('invalidates automatic translations when the source name changes but preserves manual translations', async () => {
    const owner = await createSession();
    emails.push(owner.email);

    const create = async (name: string) => {
      const response = await app.request('/api/library/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({ name, locale: 'zh-CN' }),
      });
      expect(response.status).toBe(201);
      return (await response.json()) as { id: string };
    };

    const automatic = await create('英语学习');
    invokeAiMock.mockReset().mockResolvedValueOnce({
      content: { translations: [{ locale: 'en-US', name: 'English Learning' }] },
      model: { rowId: 'mock-model', label: 'Mock', modelId: 'mock' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
    await app.request(`/api/library/tags/${automatic.id}/translations/complete`, {
      method: 'POST',
      headers: { cookie: owner.cookie },
    });

    const sourceRename = await app.request(`/api/library/tags/${automatic.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ name: '历史', locale: 'zh-CN' }),
    });
    expect(await sourceRename.json()).toMatchObject({
      id: automatic.id,
      name: '历史',
      localizedNames: { 'zh-CN': '历史' },
      userEditedLocales: ['zh-CN'],
    });

    const manual = await create('文学');
    const manualTranslation = await app.request(`/api/library/tags/${manual.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ name: 'Fiction', locale: 'en-US' }),
    });
    expect(manualTranslation.status).toBe(200);
    const manualSourceRename = await app.request(`/api/library/tags/${manual.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ name: '历史文学', locale: 'zh-CN' }),
    });
    const manuallyProtected = (await manualSourceRename.json()) as {
      id: string;
      name: string;
      localizedNames: Record<string, string>;
      userEditedLocales: string[];
    };
    expect(manuallyProtected).toMatchObject({
      id: manual.id,
      name: '历史文学',
      localizedNames: { 'zh-CN': '历史文学', 'en-US': 'Fiction' },
    });
    expect(manuallyProtected.userEditedLocales).toEqual(expect.arrayContaining(['zh-CN', 'en-US']));
  });

  it('keeps tag CRUD private, allows same normalized name per user, and rejects invalid names', async () => {
    const owner = await createSession();
    const other = await createSession();
    emails.push(owner.email, other.email);
    const ownerWorkId = await createPersonalWork(owner.userId, 'Tagged Personal Work');
    workIds.push(ownerWorkId);

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
    const assignment = await app.request(`/api/library/${ownerWorkId}/tags/${ownerTag.id}`, {
      method: 'PUT',
      headers: { cookie: owner.cookie },
    });
    expect(assignment.status).toBe(204);
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
    expect(ownerTags).toEqual([
      {
        id: ownerTag.id,
        name: 'Favorite',
        localizedNames: { 'zh-CN': 'Favorite' },
        sourceLocale: 'zh-CN',
        userEditedLocales: ['zh-CN'],
        bookCount: 1,
      },
    ]);
    expect(
      await db
        .select()
        .from(userWorkTagTable)
        .where(
          and(
            eq(userWorkTagTable.userId, owner.userId),
            eq(userWorkTagTable.workId, ownerWorkId),
            eq(userWorkTagTable.tagId, ownerTag.id),
          ),
        ),
    ).toHaveLength(1);
  });

  it('allows only owner Personal Works and saved Catalog Works, and enforces owner consistency in the database', async () => {
    const owner = await createSession();
    const other = await createSession();
    emails.push(owner.email, other.email);
    const ownWorkId = await createPersonalWork(owner.userId, 'Owner Personal Work');
    const otherWorkId = await createPersonalWork(other.userId, 'Other Personal Work');
    workIds.push(ownWorkId, otherWorkId);
    await db.insert(readingStateTable).values({
      id: randomUUID(),
      userId: owner.userId,
      workId: ownWorkId,
      status: 'in_progress',
      addedAt: new Date(),
      lastReadAt: new Date(),
      completedAt: null,
    });
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
    const readingStates = await db
      .select({ status: readingStateTable.status })
      .from(readingStateTable)
      .where(and(eq(readingStateTable.userId, owner.userId), eq(readingStateTable.workId, ownWorkId)));
    expect(readingStates).toEqual([{ status: 'in_progress' }]);
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
