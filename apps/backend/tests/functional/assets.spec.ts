import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { contentAsset as contentAssetTable, readingWork as readingWorkTable, user as userTable } from '@gloaming/db';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';

import app from '@/app';
import { db } from '@/db';
import { resetObjectStoreCache, setObjectStoreForTests } from '@/modules/oss';

import { createMemoryObjectStore } from '../helpers/memory-oss';

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

describe('GET /api/assets/:assetId (unified asset gateway)', () => {
  const memory = createMemoryObjectStore();
  const workIds: string[] = [];
  const assetIds: string[] = [];
  let adminCookie = '';
  let userCookie = '';

  async function seedWork(status: string): Promise<string> {
    const id = `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(readingWorkTable).values({
      id,
      title: `Work ${id}`,
      status,
      originKind: 'admin_epub',
    });
    workIds.push(id);
    return id;
  }

  async function seedAsset(workId: string, kind: string, key: string): Promise<string> {
    const id = `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(contentAssetTable).values({
      id,
      workId,
      kind,
      storageKey: key,
      mimeType: 'image/png',
      contentHash: 'content-hash',
      status: 'ready',
    });
    assetIds.push(id);
    return id;
  }

  async function seedImage(workId: string, label: string): Promise<string> {
    const key = `assets-test/${label}.png`;
    memory.store.set(key, { body: Buffer.from(`png-data-${label}`), contentType: 'image/png' });
    return seedAsset(workId, 'image', key);
  }

  beforeAll(async () => {
    memory.store.clear();
    setObjectStoreForTests(memory);
    adminCookie = (await createSession('admin')).cookie;
    userCookie = (await createSession('user')).cookie;
  });

  afterAll(async () => {
    for (const id of assetIds) {
      await db.delete(contentAssetTable).where(eq(contentAssetTable.id, id));
    }
    for (const id of workIds) {
      await db.delete(readingWorkTable).where(eq(readingWorkTable.id, id));
    }
    resetObjectStoreCache();
  });

  it('serves published work images to anonymous visitors', async () => {
    const workId = await seedWork('published');
    const assetId = await seedImage(workId, 'pub-anon');

    const response = await app.request(`/api/assets/${assetId}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('png-data-pub-anon');
    expect(response.headers.get('Cache-Control')).toContain('immutable');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('serves published work audio to logged-in users', async () => {
    const workId = await seedWork('published');
    const id = `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(contentAssetTable).values({
      id,
      workId,
      kind: 'audio_us',
      storageKey: `assets-test/${id}.mp3`,
      mimeType: 'audio/mpeg',
      contentHash: 'content-hash',
      status: 'ready',
    });
    assetIds.push(id);
    memory.store.set(`assets-test/${id}.mp3`, { body: Buffer.from('mp3'), contentType: 'audio/mpeg' });

    const response = await app.request(`/api/assets/${id}`, { headers: { Cookie: userCookie } });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('mp3');
  });

  it('keeps draft work images admin-only', async () => {
    const workId = await seedWork('draft');
    const assetId = await seedImage(workId, 'draft-img');

    expect((await app.request(`/api/assets/${assetId}`)).status).toBe(403);
    expect((await app.request(`/api/assets/${assetId}`, { headers: { Cookie: userCookie } })).status).toBe(403);
    const adminResponse = await app.request(`/api/assets/${assetId}`, { headers: { Cookie: adminCookie } });
    expect(adminResponse.status).toBe(200);
    expect(await adminResponse.text()).toBe('png-data-draft-img');
  });

  it('keeps origin_file admin-only', async () => {
    const workId = await seedWork('draft');
    const assetId = await seedAsset(workId, 'origin_file', `assets-test/${workId}/origin.epub`);
    memory.store.set(`assets-test/${workId}/origin.epub`, {
      body: Buffer.from('epub'),
      contentType: 'application/epub+zip',
    });

    expect((await app.request(`/api/assets/${assetId}`)).status).toBe(403);
    const adminResponse = await app.request(`/api/assets/${assetId}`, { headers: { Cookie: adminCookie } });
    expect(adminResponse.status).toBe(200);
    expect(await adminResponse.text()).toBe('epub');
  });

  it('returns 404 for unknown assets', async () => {
    expect((await app.request('/api/assets/does-not-exist')).status).toBe(404);
  });

  it('honors byte ranges with a 206 partial response', async () => {
    const workId = await seedWork('published');
    const assetId = await seedImage(workId, 'range');

    const response = await app.request(`/api/assets/${assetId}`, {
      headers: { Range: 'bytes=0-3' },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 0-3/14');
    expect(await response.text()).toBe('png-');
  });
});
