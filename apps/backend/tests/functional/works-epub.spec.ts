import { createHash } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  contentAsset as contentAssetTable,
  readingWork as readingWorkTable,
  uploadedObject as uploadedObjectTable,
  user as userTable,
} from '@gloaming/db';
import type { CreateEpubWorkResult, EpubReuseResult } from '@gloaming/shared';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';

import app from '@/app';
import { db } from '@/db';
import { resetObjectStoreCache, setObjectStoreForTests } from '@/modules/oss';

import { createMemoryObjectStore } from '../helpers/memory-oss';

const password = 'password123';

const ZIP_BYTES = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('fake epub content for tests')]);
const ZIP_HASH = createHash('sha256').update(ZIP_BYTES).digest('hex');

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

async function signUp(input: { email: string; username: string; name: string }) {
  return app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({
      email: input.email,
      password,
      name: input.name,
      username: input.username,
    }),
  });
}

async function markEmailVerified(email: string) {
  await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.email, email));
}

async function setUserRole(email: string, role: string) {
  await db.update(userTable).set({ role }).where(eq(userTable.email, email));
}

async function signInEmail(email: string) {
  return app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password }),
  });
}

async function createSession(role: 'user' | 'admin' = 'user') {
  const email = uniqueEmail(role);
  const username = `${role}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  expect((await signUp({ email, username, name: role })).status).toBe(200);
  await markEmailVerified(email);
  if (role === 'admin') {
    await setUserRole(email, AUTH_ADMIN_ROLE);
  }
  const login = await signInEmail(email);
  expect(login.status).toBe(200);
  return { email, cookie: cookieHeader(login) };
}

async function uploadEpub(cookie: string, input: { fileName: string; bytes: Buffer; type: string }) {
  const form = new FormData();
  form.append('file', new File([new Blob([input.bytes])], input.fileName, { type: input.type }));
  return app.request('/api/admin/works/epub', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form,
  });
}

async function reuseEpub(cookie: string, input: { fileName: string; contentHash: string }) {
  return app.request('/api/admin/works/epub/reuse', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

describe('POST /api/admin/works/epub (dedupe-aware)', () => {
  const memory = createMemoryObjectStore();
  const createdWorkIds: string[] = [];
  let adminCookie = '';
  let userCookie = '';

  beforeAll(async () => {
    memory.store.clear();
    setObjectStoreForTests(memory);
    adminCookie = (await createSession('admin')).cookie;
    userCookie = (await createSession('user')).cookie;
  });

  afterAll(async () => {
    for (const workId of createdWorkIds) {
      await db.delete(readingWorkTable).where(eq(readingWorkTable.id, workId));
    }
    await db.delete(uploadedObjectTable).where(eq(uploadedObjectTable.contentHash, ZIP_HASH));
    resetObjectStoreCache();
  });

  it('requires admin', async () => {
    const response = await uploadEpub(userCookie, {
      fileName: 'book.epub',
      bytes: ZIP_BYTES,
      type: 'application/epub+zip',
    });
    expect(response.status).toBe(403);
  });

  it('uploads an EPUB, creates a draft work, an origin_file asset and a dedup row', async () => {
    const response = await uploadEpub(adminCookie, {
      fileName: 'The Great Book.epub',
      bytes: ZIP_BYTES,
      type: 'application/epub+zip',
    });
    expect(response.status).toBe(201);

    const result = (await response.json()) as CreateEpubWorkResult;
    expect(result.title).toBe('The Great Book');
    expect(result.status).toBe('uploaded');
    expect(result.originKind).toBe('admin_epub');
    expect(result.asset.storageKey).toBe(`epub/${ZIP_HASH}.epub`);
    expect(result.asset.contentHash).toBe(ZIP_HASH);
    expect(result.asset.size).toBe(ZIP_BYTES.length);
    createdWorkIds.push(result.id);

    expect(memory.store.has(result.asset.storageKey)).toBe(true);

    const [workRow] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, result.id));
    expect(workRow).toBeDefined();
    expect(workRow?.originKind).toBe('admin_epub');
    expect(workRow?.originMeta).toMatchObject({ originalFileName: 'The Great Book.epub' });

    const assetRows = await db.select().from(contentAssetTable).where(eq(contentAssetTable.workId, result.id));
    expect(assetRows).toHaveLength(1);
    expect(assetRows[0]?.kind).toBe('origin_file');
    expect(assetRows[0]?.storageKey).toBe(result.asset.storageKey);

    const [dedupRow] = await db.select().from(uploadedObjectTable).where(eq(uploadedObjectTable.contentHash, ZIP_HASH));
    expect(dedupRow).toBeDefined();
    expect(dedupRow?.refCount).toBe(1);
  });

  it('reuses the stored object when the same file is uploaded again', async () => {
    const objectsBefore = memory.store.size;
    const response = await uploadEpub(adminCookie, {
      fileName: 'The Great Book (copy).epub',
      bytes: ZIP_BYTES,
      type: 'application/epub+zip',
    });
    expect(response.status).toBe(201);

    const result = (await response.json()) as CreateEpubWorkResult;
    createdWorkIds.push(result.id);
    expect(result.asset.storageKey).toBe(`epub/${ZIP_HASH}.epub`);
    expect(memory.store.size).toBe(objectsBefore);
    expect(result.originMeta).toMatchObject({ reused: true });

    const [dedupRow] = await db.select().from(uploadedObjectTable).where(eq(uploadedObjectTable.contentHash, ZIP_HASH));
    expect(dedupRow?.refCount).toBe(2);
  });

  it('reuse endpoint creates a work instantly when the hash exists', async () => {
    const response = await reuseEpub(adminCookie, { fileName: 'Reuse Me.epub', contentHash: ZIP_HASH });
    expect(response.status).toBe(201);

    const result = (await response.json()) as EpubReuseResult & { id: string };
    expect(result.duplicated).toBe(true);
    expect(result.asset.storageKey).toBe(`epub/${ZIP_HASH}.epub`);
    createdWorkIds.push(result.id);
    expect(memory.store.has(result.asset.storageKey)).toBe(true);
  });

  it('reuse endpoint misses for unknown hashes', async () => {
    const unknownHash = createHash('sha256').update('never uploaded').digest('hex');
    const response = await reuseEpub(adminCookie, { fileName: 'Unknown.epub', contentHash: unknownHash });
    expect(response.status).toBe(200);
    expect((await response.json()) as EpubReuseResult).toEqual({ duplicated: false });
  });

  it('reuse endpoint rejects malformed hashes', async () => {
    const response = await reuseEpub(adminCookie, { fileName: 'Bad.epub', contentHash: 'not-a-hash' });
    expect(response.status).toBe(400);
  });

  it('rejects non-EPUB files with a user-facing message', async () => {
    const response = await uploadEpub(adminCookie, {
      fileName: 'notes.txt',
      bytes: Buffer.from('plain text'),
      type: 'text/plain',
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain('epub');
  });

  it('rejects EPUB files that are not zip archives', async () => {
    const response = await uploadEpub(adminCookie, {
      fileName: 'fake.epub',
      bytes: Buffer.from('definitely not a zip'),
      type: 'application/epub+zip',
    });
    expect(response.status).toBe(400);
  });

  it('keeps the shared object until the last referencing work is deleted', async () => {
    const uniqueBytes = Buffer.concat([ZIP_BYTES, Buffer.from('unique shared-object payload')]);
    const first = (await (
      await uploadEpub(adminCookie, { fileName: 'Shared A.epub', bytes: uniqueBytes, type: 'application/epub+zip' })
    ).json()) as CreateEpubWorkResult;
    const second = (await (
      await uploadEpub(adminCookie, { fileName: 'Shared B.epub', bytes: uniqueBytes, type: 'application/epub+zip' })
    ).json()) as CreateEpubWorkResult;
    createdWorkIds.push(first.id, second.id);
    expect(first.asset.storageKey).toBe(second.asset.storageKey);

    const deleteFirst = await app.request(`/api/admin/works/${first.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(deleteFirst.status).toBe(204);
    expect(memory.store.has(first.asset.storageKey)).toBe(true);

    const deleteSecond = await app.request(`/api/admin/works/${second.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
    expect(deleteSecond.status).toBe(204);
    expect(memory.store.has(second.asset.storageKey)).toBe(false);
  });

  it('lists works as compact summaries without part bodies', async () => {
    const upload = await uploadEpub(adminCookie, {
      fileName: 'List Summary.epub',
      bytes: ZIP_BYTES,
      type: 'application/epub+zip',
    });
    const created = (await upload.json()) as CreateEpubWorkResult;
    createdWorkIds.push(created.id);

    const response = await app.request('/api/admin/works', { headers: { Cookie: adminCookie } });
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      items: Array<{ id: string; partCount?: number; parts?: unknown }>;
    };
    const row = data.items.find((item) => item.id === created.id);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty('parts');
    expect(typeof row?.partCount).toBe('number');
  });
});

describe('publish / unpublish status guards', () => {
  const memory = createMemoryObjectStore();
  const createdWorkIds: string[] = [];
  let adminCookie = '';

  beforeAll(async () => {
    memory.store.clear();
    setObjectStoreForTests(memory);
    adminCookie = (await createSession('admin')).cookie;
  });

  afterAll(async () => {
    for (const workId of createdWorkIds) {
      await db.delete(readingWorkTable).where(eq(readingWorkTable.id, workId));
    }
    await db.delete(uploadedObjectTable).where(eq(uploadedObjectTable.contentHash, ZIP_HASH));
    resetObjectStoreCache();
  });

  async function publishRequest(id: string) {
    return app.request(`/api/admin/works/${id}/publish`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
  }

  async function unpublishRequest(id: string) {
    return app.request(`/api/admin/works/${id}/unpublish`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
  }

  it('refuses to publish a processing work', async () => {
    const upload = await uploadEpub(adminCookie, {
      fileName: 'Processing.epub',
      bytes: ZIP_BYTES,
      type: 'application/epub+zip',
    });
    const created = (await upload.json()) as CreateEpubWorkResult;
    createdWorkIds.push(created.id);

    const publish = await publishRequest(created.id);
    expect(publish.status).toBe(409);
  });

  it('refuses to publish a failed work', async () => {
    const upload = await uploadEpub(adminCookie, {
      fileName: 'Failed.epub',
      bytes: ZIP_BYTES,
      type: 'application/epub+zip',
    });
    const created = (await upload.json()) as CreateEpubWorkResult;
    createdWorkIds.push(created.id);
    await db
      .update(readingWorkTable)
      .set({ status: 'failed', originMeta: { lastError: 'boom' } })
      .where(eq(readingWorkTable.id, created.id));

    const publish = await publishRequest(created.id);
    expect(publish.status).toBe(409);
  });

  it('refuses to unpublish a non-published work', async () => {
    const response = await app.request('/api/admin/works', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Guard Draft', body: 'Some body text.' }),
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    createdWorkIds.push(created.id);

    const unpublish = await unpublishRequest(created.id);
    expect(unpublish.status).toBe(409);
  });

  it('publishes a draft with required fields and unpublishes it back', async () => {
    const response = await app.request('/api/admin/works', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Publishable Draft', body: 'Some body text.' }),
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    createdWorkIds.push(created.id);

    await app.request(`/api/admin/works/${created.id}`, {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources: ['demo'], tags: ['story'] }),
    });

    const publish = await publishRequest(created.id);
    expect(publish.status).toBe(200);
    expect(((await publish.json()) as { status: string }).status).toBe('published');

    const unpublish = await unpublishRequest(created.id);
    expect(unpublish.status).toBe(200);
    expect(((await unpublish.json()) as { status: string }).status).toBe('ready');
  });
});
