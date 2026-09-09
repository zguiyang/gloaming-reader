import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  contentAsset as contentAssetTable,
  readingWork as readingWorkTable,
  uploadedObject as uploadedObjectTable,
  user as userTable,
} from '@gloaming/db';
import { assetCleanupResultSchema, assetObjectListDataSchema, assetScanReportSchema } from '@gloaming/shared/assets';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';

import app from '@/app';
import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import type { ObjectStore } from '@/lib/oss';
import { getRedis } from '@/lib/redis';
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

async function createSession(role: 'user' | 'admin') {
  const email = uniqueEmail(`asset-mgmt-${role}`);
  const username = `am_${role}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  expect((await signUp({ email, username, name: role })).status).toBe(200);
  await db
    .update(userTable)
    .set({ emailVerified: true, ...(role === 'admin' ? { role: AUTH_ADMIN_ROLE } : {}) })
    .where(eq(userTable.email, email));
  const login = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password }),
  });
  expect(login.status).toBe(200);
  return { email, cookie: cookieHeader(login) };
}

describe('asset management admin APIs', () => {
  const createdEmails: string[] = [];
  const workIds: string[] = [];
  const assetIds: string[] = [];
  const uploadedIds: string[] = [];
  let adminCookie = '';
  let userCookie = '';
  let memory = createMemoryObjectStore();

  beforeAll(async () => {
    const admin = await createSession('admin');
    const user = await createSession('user');
    createdEmails.push(admin.email, user.email);
    adminCookie = admin.cookie;
    userCookie = user.cookie;
  });

  beforeEach(() => {
    memory = createMemoryObjectStore();
    setObjectStoreForTests(memory);
  });

  afterAll(async () => {
    resetObjectStoreCache();
    if (assetIds.length > 0) {
      await db.delete(contentAssetTable).where(inArray(contentAssetTable.id, assetIds));
    }
    if (uploadedIds.length > 0) {
      await db.delete(uploadedObjectTable).where(inArray(uploadedObjectTable.id, uploadedIds));
    }
    if (workIds.length > 0) {
      await db.delete(readingWorkTable).where(inArray(readingWorkTable.id, workIds));
    }
    for (const email of createdEmails) {
      await db.delete(userTable).where(eq(userTable.email, email));
    }
  });

  async function insertWork(originMeta: Record<string, unknown> = {}) {
    const id = `am-work-${randomUUID()}`;
    await db.insert(readingWorkTable).values({
      id,
      title: 'Asset management test work',
      originKind: 'admin_text',
      originMeta,
    });
    workIds.push(id);
    return id;
  }

  async function insertAsset(input: {
    workId: string;
    kind: string;
    storageKey: string;
    meta?: Record<string, unknown>;
  }) {
    const id = `am-asset-${randomUUID()}`;
    await db.insert(contentAssetTable).values({
      id,
      workId: input.workId,
      kind: input.kind,
      storageKey: input.storageKey,
      mimeType: 'application/octet-stream',
      contentHash: `hash-${id}`,
      meta: input.meta ?? {},
      status: 'ready',
    });
    assetIds.push(id);
    return id;
  }

  async function putObject(key: string, size: number) {
    await memory.put({ key, body: Buffer.alloc(size, 1), contentType: 'application/octet-stream' });
  }

  it('rejects non-admin callers', async () => {
    const anonymous = await app.request('/api/admin/assets/scan', { method: 'POST' });
    expect(anonymous.status).toBe(HTTP_STATUS.UNAUTHORIZED);

    const forbidden = await app.request('/api/admin/assets/scan', {
      method: 'POST',
      headers: { Cookie: userCookie },
    });
    expect(forbidden.status).toBe(HTTP_STATUS.FORBIDDEN);
  });

  it('scans referenced, orphan, and missing objects including audio segments', async () => {
    const workId = await insertWork();
    const chapter = `part-audio/${workId}/audio_us/h/chapter.mp3`;
    const segment = `part-audio/${workId}/audio_us/h/seg/0000.mp3`;
    const cover = `covers/${workId}/cover.jpg`;
    const orphan = `orphan/${workId}/leftover.mp3`;
    const missing = `covers/${workId}/gone.jpg`;

    await insertAsset({
      workId,
      kind: 'audio_us',
      storageKey: chapter,
      meta: {
        objectKeys: [segment, chapter],
        timeline: [
          {
            index: 0,
            textHash: 't0',
            startMs: 0,
            durationMs: 1000,
            storageKey: segment,
            wordTimings: [],
          },
        ],
      },
    });
    await insertAsset({ workId, kind: 'cover', storageKey: missing });

    await putObject(chapter, 100);
    await putObject(segment, 40);
    await putObject(cover, 10);
    await putObject(orphan, 60);

    const scan = await app.request('/api/admin/assets/scan', {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    expect(scan.status).toBe(200);
    const report = assetScanReportSchema.parse(await scan.json());
    expect(report.orphanCount).toBeGreaterThanOrEqual(2);
    expect(report.missingCount).toBeGreaterThanOrEqual(1);
    expect(report.referencedObjectCount).toBeGreaterThanOrEqual(2);

    const orphans = await app.request(
      `/api/admin/assets/scans/${report.scanId}/objects?status=orphan&sortBy=size&sortOrder=desc`,
      { headers: { Cookie: adminCookie } },
    );
    expect(orphans.status).toBe(200);
    const orphanList = assetObjectListDataSchema.parse(await orphans.json());
    expect(orphanList.items.some((item) => item.key === orphan)).toBe(true);
    expect(orphanList.items.some((item) => item.key === segment)).toBe(false);

    const missingListResponse = await app.request(`/api/admin/assets/scans/${report.scanId}/objects?status=missing`, {
      headers: { Cookie: adminCookie },
    });
    const missingList = assetObjectListDataSchema.parse(await missingListResponse.json());
    expect(missingList.items.some((item) => item.key === missing)).toBe(true);
  });

  it('cleans only still-orphan objects and skips keys that become referenced', async () => {
    const workId = await insertWork();
    const orphanKeep = `orphan/${workId}/keep.mp3`;
    const orphanDelete = `orphan/${workId}/delete.mp3`;
    const referenced = `covers/${workId}/ok.jpg`;

    await insertAsset({ workId, kind: 'cover', storageKey: referenced });
    await putObject(orphanKeep, 20);
    await putObject(orphanDelete, 30);
    await putObject(referenced, 10);

    const scan = await app.request('/api/admin/assets/scan', {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    const report = assetScanReportSchema.parse(await scan.json());

    await insertAsset({ workId, kind: 'image', storageKey: orphanKeep });

    const cleanup = await app.request(`/api/admin/assets/scans/${report.scanId}/cleanup`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmed: true }),
    });
    expect(cleanup.status).toBe(200);
    const result = assetCleanupResultSchema.parse(await cleanup.json());
    expect(result.deletedCount).toBeGreaterThanOrEqual(1);
    expect(result.skippedReferencedCount).toBeGreaterThanOrEqual(1);
    expect(memory.store.has(orphanDelete)).toBe(false);
    expect(memory.store.has(orphanKeep)).toBe(true);
    expect(memory.store.has(referenced)).toBe(true);

    const expired = await app.request(`/api/admin/assets/scans/${report.scanId}/cleanup`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmed: true }),
    });
    expect(expired.status).toBe(HTTP_STATUS.CONFLICT);
  });

  it('treats uploaded_object and workflowParseArtifacts keys as referenced', async () => {
    const workId = `am-work-${randomUUID()}`;
    await db.insert(readingWorkTable).values({
      id: workId,
      title: 'Asset management test work',
      originKind: 'admin_text',
      originMeta: {
        workflowParseArtifacts: [{ attemptToken: 'tok', keys: [`book-images/${workId}/a/h.png`] }],
      },
    });
    workIds.push(workId);
    const epubKey = `epub/${workId}.epub`;
    const parseKey = `book-images/${workId}/a/h.png`;
    const uploadedId = `am-up-${randomUUID()}`;
    await db.insert(uploadedObjectTable).values({
      id: uploadedId,
      contentHash: `hash-${uploadedId}`,
      storageKey: epubKey,
      mimeType: 'application/epub+zip',
      size: 12,
    });
    uploadedIds.push(uploadedId);

    await putObject(epubKey, 12);
    await putObject(parseKey, 8);

    const scan = await app.request('/api/admin/assets/scan', {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    const report = assetScanReportSchema.parse(await scan.json());
    const list = assetObjectListDataSchema.parse(
      await (
        await app.request(`/api/admin/assets/scans/${report.scanId}/objects?status=referenced`, {
          headers: { Cookie: adminCookie },
        })
      ).json(),
    );
    expect(list.items.some((item) => item.key === epubKey)).toBe(true);
    expect(list.items.some((item) => item.key === parseKey)).toBe(true);
  });

  it('returns failed keys when delete throws', async () => {
    const workId = await insertWork();
    const failKey = `orphan/${workId}/fail.mp3`;
    const okKey = `orphan/${workId}/ok.mp3`;
    await putObject(failKey, 15);
    await putObject(okKey, 15);

    const base = memory;
    const failingStore: ObjectStore = {
      put: (input) => base.put(input),
      get: (key) => base.get(key),
      getStream: (key, range) => base.getStream(key, range),
      exists: (key) => base.exists(key),
      list: (prefix, cursor) => base.list(prefix, cursor),
      async delete(key) {
        if (key === failKey) throw new Error('simulated delete failure');
        await base.delete(key);
      },
    };
    setObjectStoreForTests(failingStore);

    const scan = await app.request('/api/admin/assets/scan', {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    const report = assetScanReportSchema.parse(await scan.json());

    const cleanup = await app.request(`/api/admin/assets/scans/${report.scanId}/cleanup`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmed: true }),
    });
    const result = assetCleanupResultSchema.parse(await cleanup.json());
    expect(result.failedCount).toBeGreaterThanOrEqual(1);
    expect(result.failed.some((entry) => entry.key === failKey)).toBe(true);
    expect(base.store.has(okKey)).toBe(false);
  });

  it('returns conflict when scan snapshot is missing', async () => {
    await getRedis().del('asset-management:scan:scan_missing');
    const response = await app.request('/api/admin/assets/scans/scan_missing/objects', {
      headers: { Cookie: adminCookie },
    });
    expect(response.status).toBe(HTTP_STATUS.CONFLICT);
  });
});
