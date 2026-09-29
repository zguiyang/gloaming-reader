import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  contentAsset as contentAssetTable,
  readingPart as readingPartTable,
  readingWork as readingWorkTable,
  uploadedObject as uploadedObjectTable,
  user as userTable,
  userLibraryItem as userLibraryItemTable,
} from '@gloaming/db';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';

import app from '@/app';
import { processContentParse } from '@/application/jobs/content-parse';
import { hashFileContent } from '@/domains/assets/uploads';
import { db } from '@/infra/db';
import * as queueLib from '@/infra/queue';
import { resetObjectStoreCache, setObjectStoreForTests } from '@/infra/storage';

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

  beforeAll(async () => {
    memory.store.clear();
    setObjectStoreForTests(memory);
    owner = await createSession('user');
    other = await createSession('user');
    admin = await createSession('admin');
    createdEmails.push(owner.email, other.email, admin.email);
    enqueueSpy = vi.spyOn(queueLib, 'enqueue').mockResolvedValue('test-job');
  });

  afterAll(async () => {
    enqueueSpy?.mockRestore();
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
  });
});
