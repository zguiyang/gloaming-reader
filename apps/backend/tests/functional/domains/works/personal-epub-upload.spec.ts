import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  contentAsset as contentAssetTable,
  conversation as conversationTable,
  conversationMessage as conversationMessageTable,
  readingPart as readingPartTable,
  readingState as readingStateTable,
  readingWork as readingWorkTable,
  uploadedObject as uploadedObjectTable,
  user as userTable,
  userLibraryItem as userLibraryItemTable,
  userTag as userTagTable,
  userWorkTag as userWorkTagTable,
} from '@gloaming/db';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';

import app from '@/app';
import { processContentParse } from '@/application/jobs/content-parse';
import { hashFileContent } from '@/domains/assets/uploads';
import { processPersonalWorkCleanup } from '@/domains/works/personal/management';
import { db } from '@/infra/db';
import * as queueLib from '@/infra/queue';
import { resetObjectStoreCache, setObjectStoreForTests } from '@/infra/storage';

import { createCatalogWorkFixture } from '../../../helpers/catalog-work-fixture';
import { buildSampleEpubBytes } from '../../../helpers/epub-builder';
import { createMemoryObjectStore } from '../../../helpers/memory-oss';

const password = 'password123';
const memory = createMemoryObjectStore();
const { sendAuthMailMock } = vi.hoisted(() => ({
  sendAuthMailMock: vi.fn().mockResolvedValue(undefined),
}));

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

async function createSession(role: 'user' | 'admin' = 'user') {
  const email = uniqueEmail(role);
  const username = `${role}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const signup = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password, name: role, username }),
  });
  expect(signup.status).toBe(200);
  await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.email, email));
  if (role === 'admin') {
    await db.update(userTable).set({ role: AUTH_ADMIN_ROLE }).where(eq(userTable.email, email));
  }
  const login = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password }),
  });
  expect(login.status).toBe(200);
  const [user] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, email)).limit(1);
  return { email, cookie: cookieHeader(login), userId: user!.id };
}

function uploadForm(fileName: string, bytes: Buffer): FormData {
  const form = new FormData();
  form.append('file', new File([new Blob([bytes])], fileName, { type: 'application/epub+zip' }));
  return form;
}

describe('POST /api/works (Personal EPUB)', () => {
  const createdWorkIds: string[] = [];
  const createdEmails: string[] = [];
  const createdHashes: string[] = [];
  let owner: Awaited<ReturnType<typeof createSession>>;
  let other: Awaited<ReturnType<typeof createSession>>;
  let admin: Awaited<ReturnType<typeof createSession>>;
  let enqueueSpy: ReturnType<typeof vi.spyOn<typeof queueLib, 'enqueue'>>;
  let enqueueCleanupSpy: ReturnType<typeof vi.spyOn<typeof queueLib, 'enqueueCleanup'>>;

  beforeAll(async () => {
    memory.store.clear();
    setObjectStoreForTests(memory);
    owner = await createSession('user');
    other = await createSession('user');
    admin = await createSession('admin');
    createdEmails.push(owner.email, other.email, admin.email);
    enqueueSpy = vi.spyOn(queueLib, 'enqueue').mockResolvedValue('test-job');
    enqueueCleanupSpy = vi.spyOn(queueLib, 'enqueueCleanup').mockResolvedValue('cleanup-job');
  });

  afterAll(async () => {
    enqueueSpy?.mockRestore();
    enqueueCleanupSpy?.mockRestore();
    if (createdWorkIds.length) await db.delete(readingWorkTable).where(inArray(readingWorkTable.id, createdWorkIds));
    if (createdHashes.length) {
      await db.delete(uploadedObjectTable).where(inArray(uploadedObjectTable.contentHash, createdHashes));
    }
    for (const email of createdEmails) await db.delete(userTable).where(eq(userTable.email, email));
    resetObjectStoreCache();
  });

  it('creates an owner-private work through the shared parser and keeps the response safe', async () => {
    const bytes = await buildSampleEpubBytes();
    createdHashes.push(hashFileContent(bytes));
    const response = await app.request('/api/works', {
      method: 'POST',
      headers: { Cookie: owner.cookie },
      body: uploadForm('Personal Book.epub', bytes),
    });
    expect(response.status).toBe(201);
    const result = (await response.json()) as Record<string, unknown>;
    expect(result).toEqual({ id: expect.any(String), title: 'Personal Book', processingStatus: 'uploaded' });
    expect(Object.keys(result).sort()).toEqual(['id', 'processingStatus', 'title']);
    const workId = result.id as string;
    createdWorkIds.push(workId);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy.mock.calls[0]?.[0]).toBe('content-parse');

    const [uploaded] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(uploaded).toMatchObject({
      originKind: 'user_epub',
      ownerUserId: owner.userId,
      visibility: 'private',
      publishedAt: null,
      processingStatus: 'uploaded',
    });
    expect(uploaded!.originMeta).not.toHaveProperty('ownerUserId');
    expect(
      await db
        .select({ id: userLibraryItemTable.id })
        .from(userLibraryItemTable)
        .where(eq(userLibraryItemTable.workId, workId)),
    ).toHaveLength(0);
    const sourceAssets = await db.select().from(contentAssetTable).where(eq(contentAssetTable.workId, workId));
    expect(sourceAssets).toHaveLength(1);
    expect(sourceAssets[0]).toMatchObject({ kind: 'origin_file', status: 'ready' });
    expect(memory.store.has(sourceAssets[0]!.storageKey!)).toBe(true);

    const processingDelete = await app.request(`/api/works/${workId}`, {
      method: 'DELETE',
      headers: { Cookie: owner.cookie },
    });
    expect(processingDelete.status).toBe(409);

    const spoof = await app.request('/api/works', {
      method: 'POST',
      headers: { Cookie: owner.cookie },
      body: (() => {
        const form = uploadForm('Spoof.epub', Buffer.from([0x50, 0x4b, 0x03, 0x04, 1]));
        form.append('ownerUserId', other.userId);
        return form;
      })(),
    });
    expect(spoof.status).toBe(400);
    const unauthenticated = await app.request('/api/works', {
      method: 'POST',
      body: uploadForm('Anonymous.epub', Buffer.from([0x50, 0x4b, 0x03, 0x04, 1])),
    });
    expect(unauthenticated.status).toBe(401);

    const uploadedRetryToken = uploaded!.originMeta.retryJobToken as string;
    await processContentParse({ workId, retryJobToken: uploadedRetryToken });
    const [ready] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(ready).toMatchObject({ processingStatus: 'ready', ownerUserId: owner.userId, visibility: 'private' });
    expect(ready!.title).toBe('The Great Book');
    const parts = await db.select().from(readingPartTable).where(eq(readingPartTable.workId, workId));
    expect(parts.length).toBeGreaterThan(0);
    const assets = await db.select().from(contentAssetTable).where(eq(contentAssetTable.workId, workId));
    expect(assets.some((asset) => asset.kind === 'audio_us' || asset.kind === 'audio_uk')).toBe(false);
    expect(enqueueSpy.mock.calls.map(([name]) => name)).toEqual(['content-parse']);

    expect((await app.request(`/api/reader/works/${workId}/parts`, { headers: { Cookie: owner.cookie } })).status).toBe(
      200,
    );
    expect((await app.request(`/api/reader/works/${workId}/parts`, { headers: { Cookie: other.cookie } })).status).toBe(
      404,
    );
    expect((await app.request(`/api/reader/works/${workId}/parts`)).status).toBe(404);
    expect((await app.request(`/api/catalog/works/${workId}`, { headers: { Cookie: other.cookie } })).status).toBe(404);
    expect(await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId))).toMatchObject([
      expect.objectContaining({ ownerUserId: owner.userId, visibility: 'private', publishedAt: null }),
    ]);

    const originAsset = assets.find((asset) => asset.kind === 'origin_file')!;
    expect((await app.request(`/api/assets/${originAsset.id}`, { headers: { Cookie: owner.cookie } })).status).toBe(
      200,
    );
    expect((await app.request(`/api/assets/${originAsset.id}`, { headers: { Cookie: other.cookie } })).status).toBe(
      403,
    );
    expect((await app.request(`/api/assets/${originAsset.id}`)).status).toBe(403);

    const patchResponse = await app.request(`/api/works/${workId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: owner.cookie },
      body: JSON.stringify({ title: 'My title', author: 'My author', description: 'My note' }),
    });
    expect(patchResponse.status).toBe(200);
    expect(await patchResponse.json()).toEqual({
      id: workId,
      title: 'My title',
      author: 'My author',
      description: 'My note',
    });
    expect(
      (
        await app.request(`/api/works/${workId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Cookie: other.cookie },
          body: JSON.stringify({ title: 'Spoofed' }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/works/${workId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Cookie: admin.cookie },
          body: JSON.stringify({ title: 'Admin override' }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/works/${workId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Cookie: owner.cookie },
          body: JSON.stringify({ ownerUserId: other.userId, title: 'Spoofed owner' }),
        })
      ).status,
    ).toBe(400);
    await expect(
      app.request('/api/library', { headers: { Cookie: other.cookie } }).then((response) => response.text()),
    ).resolves.toContain('"items":[]');

    enqueueCleanupSpy.mockClear();
    const readyDeleted = await app.request(`/api/works/${workId}`, {
      method: 'DELETE',
      headers: { Cookie: owner.cookie },
    });
    expect(readyDeleted.status).toBe(200);
    expect(await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId))).toHaveLength(0);
    const cleanupData = enqueueCleanupSpy.mock.calls[0]![1] as Parameters<typeof processPersonalWorkCleanup>[0];
    await processPersonalWorkCleanup(cleanupData);
    expect(memory.store.has(originAsset.storageKey!)).toBe(false);
  });

  it('marks malformed EPUB parsing failed without creating readable parts or derived assets', async () => {
    const bytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('not a real epub')]);
    createdHashes.push(hashFileContent(bytes));
    const response = await app.request('/api/works', {
      method: 'POST',
      headers: { Cookie: owner.cookie },
      body: uploadForm('Broken.epub', bytes),
    });
    expect(response.status).toBe(201);
    const result = (await response.json()) as { id: string };
    createdWorkIds.push(result.id);
    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, result.id));
    const token = work!.originMeta.retryJobToken as string;
    await expect(processContentParse({ workId: result.id, retryJobToken: token })).rejects.toThrow();
    const [failed] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, result.id));
    expect(failed).toMatchObject({ processingStatus: 'failed', ownerUserId: owner.userId, visibility: 'private' });
    expect((await db.select().from(readingPartTable).where(eq(readingPartTable.workId, result.id))).length).toBe(0);
    const assets = await db.select().from(contentAssetTable).where(eq(contentAssetTable.workId, result.id));
    expect(assets.map((asset) => asset.kind)).toEqual(['origin_file']);

    const originalKey = assets[0]!.storageKey;
    const [tag] = await db
      .insert(userTagTable)
      .values({
        id: randomUUID(),
        userId: owner.userId,
        name: '英语学习',
        normalizedName: `english-${result.id}`,
      })
      .returning();
    await db.insert(userWorkTagTable).values({ userId: owner.userId, workId: result.id, tagId: tag!.id });
    await db.insert(readingStateTable).values({
      id: randomUUID(),
      userId: owner.userId,
      workId: result.id,
      currentPartId: null,
      completedThroughSortOrder: -1,
      revision: 0,
      anchorKind: null,
      anchorValue: null,
      status: 'in_progress',
      addedAt: new Date(),
      lastReadAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const conversationId = randomUUID();
    await db.insert(conversationTable).values({
      id: conversationId,
      userId: owner.userId,
      surface: 'assist-read',
      subjectType: 'reading_work',
      subjectId: result.id,
    });
    await db.insert(conversationMessageTable).values({
      id: randomUUID(),
      conversationId,
      role: 'user',
      content: 'question',
      status: 'complete',
    });

    const duplicateResponse = await app.request('/api/works', {
      method: 'POST',
      headers: { Cookie: other.cookie },
      body: uploadForm('Shared Broken.epub', bytes),
    });
    expect(duplicateResponse.status).toBe(201);
    const duplicate = (await duplicateResponse.json()) as { id: string };
    createdWorkIds.push(duplicate.id);
    await db.update(readingWorkTable).set({ processingStatus: 'failed' }).where(eq(readingWorkTable.id, duplicate.id));
    const sharedBefore = await db
      .select()
      .from(uploadedObjectTable)
      .where(eq(uploadedObjectTable.contentHash, hashFileContent(bytes)));
    expect(sharedBefore[0]?.refCount).toBe(2);

    enqueueCleanupSpy.mockClear();
    const deleted = await app.request(`/api/works/${result.id}`, {
      method: 'DELETE',
      headers: { Cookie: owner.cookie },
    });
    expect(deleted.status).toBe(200);
    expect(await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, result.id))).toHaveLength(0);
    expect(await db.select().from(readingPartTable).where(eq(readingPartTable.workId, result.id))).toHaveLength(0);
    expect(await db.select().from(readingStateTable).where(eq(readingStateTable.workId, result.id))).toHaveLength(0);
    expect(await db.select().from(userWorkTagTable).where(eq(userWorkTagTable.workId, result.id))).toHaveLength(0);
    expect(await db.select().from(userTagTable).where(eq(userTagTable.id, tag!.id))).toHaveLength(1);
    expect(await db.select().from(conversationTable).where(eq(conversationTable.id, conversationId))).toHaveLength(0);
    expect(
      await db
        .select()
        .from(conversationMessageTable)
        .where(eq(conversationMessageTable.conversationId, conversationId)),
    ).toHaveLength(0);
    expect(
      (
        await db
          .select()
          .from(uploadedObjectTable)
          .where(eq(uploadedObjectTable.contentHash, hashFileContent(bytes)))
      )[0]?.refCount,
    ).toBe(1);
    expect(memory.store.has(originalKey!)).toBe(true);
    expect(enqueueCleanupSpy).toHaveBeenCalledOnce();
    await processPersonalWorkCleanup(
      enqueueCleanupSpy.mock.calls[0]![1] as Parameters<typeof processPersonalWorkCleanup>[0],
    );
    expect(memory.store.has(originalKey!)).toBe(true);

    const duplicateDeleted = await app.request(`/api/works/${duplicate.id}`, {
      method: 'DELETE',
      headers: { Cookie: other.cookie },
    });
    expect(duplicateDeleted.status).toBe(200);
    const finalCleanup = enqueueCleanupSpy.mock.calls.at(-1)![1] as Parameters<typeof processPersonalWorkCleanup>[0];
    const deleteMany = memory.deleteMany.bind(memory);
    let failDeleteOnce = true;
    memory.deleteMany = async (keys) => {
      if (failDeleteOnce) {
        failDeleteOnce = false;
        return { deleted: [], failed: keys.map((key) => ({ key, error: 'temporary failure' })) };
      }
      return deleteMany(keys);
    };
    await expect(processPersonalWorkCleanup(finalCleanup)).rejects.toThrow('Failed to delete');
    expect(memory.store.has(originalKey!)).toBe(true);
    await processPersonalWorkCleanup(finalCleanup);
    expect(memory.store.has(originalKey!)).toBe(false);
    await expect(processPersonalWorkCleanup(finalCleanup)).resolves.toEqual({ ok: true });
  });

  it('lets an Admin account upload a private Work through the ordinary User API', async () => {
    const bytes = await buildSampleEpubBytes();
    createdHashes.push(hashFileContent(bytes));
    enqueueSpy.mockClear();
    const response = await app.request('/api/works', {
      method: 'POST',
      headers: { Cookie: admin.cookie },
      body: uploadForm('Admin Personal Book.epub', bytes),
    });

    expect(response.status).toBe(201);
    const result = (await response.json()) as Record<string, unknown>;
    expect(result).toEqual({ id: expect.any(String), title: 'Admin Personal Book', processingStatus: 'uploaded' });
    const workId = result.id as string;
    createdWorkIds.push(workId);
    expect(enqueueSpy.mock.calls.map(([name]) => name)).toEqual(['content-parse']);

    const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId));
    expect(work).toMatchObject({
      originKind: 'user_epub',
      ownerUserId: admin.userId,
      visibility: 'private',
      publishedAt: null,
      processingStatus: 'uploaded',
    });

    await db.update(readingWorkTable).set({ processingStatus: 'ready' }).where(eq(readingWorkTable.id, workId));
    const edited = await app.request(`/api/works/${workId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: admin.cookie },
      body: JSON.stringify({ title: 'My own book' }),
    });
    expect(edited.status).toBe(200);
    const deleted = await app.request(`/api/works/${workId}`, { method: 'DELETE', headers: { Cookie: admin.cookie } });
    expect(deleted.status).toBe(200);
  });

  it('does not expose edit or delete capabilities for Catalog Works, including to Admin', async () => {
    const catalog = await createCatalogWorkFixture({ title: 'Catalog remains public', body: 'Catalog content.' });
    createdWorkIds.push(catalog.id);
    for (const session of [owner, admin]) {
      const patch = await app.request(`/api/works/${catalog.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: session.cookie },
        body: JSON.stringify({ title: 'Not allowed' }),
      });
      const deletion = await app.request(`/api/works/${catalog.id}`, {
        method: 'DELETE',
        headers: { Cookie: session.cookie },
      });
      expect(patch.status).toBe(404);
      expect(deletion.status).toBe(404);
    }
    expect(await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, catalog.id))).toHaveLength(1);
  });
});
