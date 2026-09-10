import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  contentAsset as contentAssetTable,
  readingWork as readingWorkTable,
  uploadedObject as uploadedObjectTable,
  user as userTable,
} from '@gloaming/db';
import {
  assetCleanupJobAcceptedSchema,
  assetCleanupJobSchema,
  assetObjectListDataSchema,
  assetScanReportSchema,
} from '@gloaming/shared/assets';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';

import app from '@/app';
import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { processAssetCleanup } from '@/jobs/asset-cleanup';
import type { ObjectStore } from '@/lib/oss';
import { getRedis } from '@/lib/redis';
import {
  acquireLock,
  CLEANUP_LOCK_KEY,
  loadCleanupJob,
  releaseLock,
  renewLock,
  saveCleanupJob,
  SCAN_LOCK_KEY,
} from '@/modules/asset-management/cleanup-store';
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

  beforeEach(async () => {
    memory = createMemoryObjectStore();
    setObjectStoreForTests(memory);
    await getRedis().del(CLEANUP_LOCK_KEY);
  });

  async function withCleanupLockHeld<T>(fn: () => Promise<T>): Promise<T> {
    const token = `test-hold-${randomUUID()}`;
    expect(await acquireLock(CLEANUP_LOCK_KEY, token, 60)).toBe(true);
    try {
      return await fn();
    } finally {
      await releaseLock(CLEANUP_LOCK_KEY, token);
    }
  }

  async function enqueueCleanup(scanId: string) {
    const cleanup = await app.request(`/api/admin/assets/scans/${scanId}/cleanup`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmed: true }),
    });
    expect(cleanup.status).toBe(HTTP_STATUS.ACCEPTED);
    return assetCleanupJobAcceptedSchema.parse(await cleanup.json());
  }

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

    expect((await app.request('/api/admin/assets/cleanup-jobs/job_x')).status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(
      (
        await app.request('/api/admin/assets/cleanup-jobs/job_x', {
          headers: { Cookie: userCookie },
        })
      ).status,
    ).toBe(HTTP_STATUS.FORBIDDEN);
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
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.scanComplete).toBe(true);

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

  it('treats timeline-only audio segments as referenced', async () => {
    const workId = await insertWork();
    const chapter = `part-audio/${workId}/audio_us/legacy/chapter.mp3`;
    const timelineOnly = `part-audio/${workId}/audio_us/legacy/seg/0000.mp3`;
    await insertAsset({
      workId,
      kind: 'audio_us',
      storageKey: chapter,
      meta: {
        objectKeys: [chapter],
        timeline: [
          {
            index: 0,
            textHash: 'legacy',
            startMs: 0,
            durationMs: 900,
            storageKey: timelineOnly,
            wordTimings: [],
          },
        ],
      },
    });
    await putObject(chapter, 80);
    await putObject(timelineOnly, 20);

    const scan = await app.request('/api/admin/assets/scan', {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    const report = assetScanReportSchema.parse(await scan.json());
    const orphans = assetObjectListDataSchema.parse(
      await (
        await app.request(`/api/admin/assets/scans/${report.scanId}/objects?status=orphan`, {
          headers: { Cookie: adminCookie },
        })
      ).json(),
    );
    const referenced = assetObjectListDataSchema.parse(
      await (
        await app.request(`/api/admin/assets/scans/${report.scanId}/objects?status=referenced`, {
          headers: { Cookie: adminCookie },
        })
      ).json(),
    );
    expect(orphans.items.some((item) => item.key === timelineOnly)).toBe(false);
    expect(referenced.items.some((item) => item.key === timelineOnly)).toBe(true);
  });

  it('classifies unreferenced historical segments as legacy_duplicate_audio and excludes them from orphan cleanup', async () => {
    const workId = await insertWork();
    const chapter = `part-audio/${workId}/audio_us/new/chapter.mp3`;
    const staleSeg = `part-audio/${workId}/audio_us/old/seg/0000.mp3`;
    const plainOrphan = `orphan/${workId}/leftover.bin`;

    await insertAsset({
      workId,
      kind: 'audio_us',
      storageKey: chapter,
      meta: { objectKeys: [chapter] },
    });
    await putObject(chapter, 90);
    await putObject(staleSeg, 30);
    await putObject(plainOrphan, 15);

    const scan = await app.request('/api/admin/assets/scan', {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    const report = assetScanReportSchema.parse(await scan.json());
    expect(report.legacyDuplicateCount).toBeGreaterThanOrEqual(1);

    const legacyList = assetObjectListDataSchema.parse(
      await (
        await app.request(`/api/admin/assets/scans/${report.scanId}/objects?status=legacy_duplicate_audio`, {
          headers: { Cookie: adminCookie },
        })
      ).json(),
    );
    const orphanList = assetObjectListDataSchema.parse(
      await (
        await app.request(`/api/admin/assets/scans/${report.scanId}/objects?status=orphan`, {
          headers: { Cookie: adminCookie },
        })
      ).json(),
    );
    expect(legacyList.items.some((item) => item.key === staleSeg)).toBe(true);
    expect(orphanList.items.some((item) => item.key === staleSeg)).toBe(false);
    expect(orphanList.items.some((item) => item.key === plainOrphan)).toBe(true);
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

    const accepted = await withCleanupLockHeld(async () => {
      const queued = await enqueueCleanup(report.scanId);
      expect(queued.status).toBe('queued');
      const concurrent = await app.request(`/api/admin/assets/scans/${report.scanId}/cleanup`, {
        method: 'POST',
        headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      });
      expect(concurrent.status).toBe(HTTP_STATUS.ACCEPTED);
      expect(assetCleanupJobAcceptedSchema.parse(await concurrent.json()).jobId).toBe(queued.jobId);
      return queued;
    });
    await processAssetCleanup({ jobId: accepted.jobId, scanId: accepted.scanId });

    const jobResponse = await app.request(`/api/admin/assets/cleanup-jobs/${encodeURIComponent(accepted.jobId)}`, {
      headers: { Cookie: adminCookie },
    });
    expect(jobResponse.status).toBe(200);
    const job = assetCleanupJobSchema.parse(await jobResponse.json());
    expect(job.status).toBe('completed');
    expect(job.deletedCount).toBeGreaterThanOrEqual(1);
    expect(job.skippedReferencedCount).toBeGreaterThanOrEqual(1);
    expect(job.verification?.ran).toBe(true);
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

  it('returns failed keys when delete throws and retries only those keys', async () => {
    const workId = await insertWork();
    const failKey = `orphan/${workId}/fail.mp3`;
    const okKey = `orphan/${workId}/ok.mp3`;
    await putObject(failKey, 15);
    await putObject(okKey, 15);

    const base = memory;
    let failDeletes = true;
    const failingStore: ObjectStore = {
      put: (input) => base.put(input),
      get: (key) => base.get(key),
      getStream: (key, range) => base.getStream(key, range),
      exists: (key) => base.exists(key),
      list: (prefix, cursor) => base.list(prefix, cursor),
      async delete(key) {
        if (failDeletes && key === failKey) throw new Error('simulated delete failure');
        await base.delete(key);
      },
    };
    setObjectStoreForTests(failingStore);

    const scan = await app.request('/api/admin/assets/scan', {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    const report = assetScanReportSchema.parse(await scan.json());

    const accepted = await withCleanupLockHeld(async () => enqueueCleanup(report.scanId));
    await processAssetCleanup({ jobId: accepted.jobId, scanId: accepted.scanId });

    const partialResponse = await app.request(`/api/admin/assets/cleanup-jobs/${encodeURIComponent(accepted.jobId)}`, {
      headers: { Cookie: adminCookie },
    });
    const partial = assetCleanupJobSchema.parse(await partialResponse.json());
    expect(partial.status).toBe('partial');
    expect(partial.failedCount).toBeGreaterThanOrEqual(1);
    expect(partial.failedSample.some((entry) => entry.key === failKey)).toBe(true);
    expect(base.store.has(okKey)).toBe(false);
    expect(base.store.has(failKey)).toBe(true);

    failDeletes = false;
    await withCleanupLockHeld(async () => {
      const retry = await app.request(`/api/admin/assets/cleanup-jobs/${encodeURIComponent(accepted.jobId)}/retry`, {
        method: 'POST',
        headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      });
      expect(retry.status).toBe(HTTP_STATUS.ACCEPTED);
    });
    await processAssetCleanup({ jobId: accepted.jobId, scanId: accepted.scanId });

    const retried = assetCleanupJobSchema.parse(
      await (
        await app.request(`/api/admin/assets/cleanup-jobs/${encodeURIComponent(accepted.jobId)}`, {
          headers: { Cookie: adminCookie },
        })
      ).json(),
    );
    expect(retried.status).toBe('completed');
    expect(base.store.has(failKey)).toBe(false);
  });

  it('returns conflict when scan snapshot is missing', async () => {
    await getRedis().del('asset-management:scan:scan_missing');
    const response = await app.request('/api/admin/assets/scans/scan_missing/objects', {
      headers: { Cookie: adminCookie },
    });
    expect(response.status).toBe(HTTP_STATUS.CONFLICT);
  });

  it('rejects cleanup for an incomplete scan snapshot', async () => {
    const scanId = `scan_incomplete_${randomUUID()}`;
    await getRedis().set(
      `asset-management:scan:${scanId}`,
      JSON.stringify({
        report: {
          scanId,
          measuredAt: new Date().toISOString(),
          scanComplete: false,
          objectCount: 1,
          totalBytes: 1,
          referencedObjectCount: 0,
          referencedBytes: 0,
          orphanCount: 1,
          orphanBytes: 1,
          missingCount: 0,
          durationMs: 8,
          categories: [],
          largestObjects: [],
        },
        objects: [],
        orphanKeys: ['orphan/incomplete.bin'],
      }),
      'EX',
      60,
    );
    const response = await app.request(`/api/admin/assets/scans/${scanId}/cleanup`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmed: true }),
    });
    expect(response.status).toBe(HTTP_STATUS.CONFLICT);
  });

  it('renews a lock only for the owning token', async () => {
    const token = `lock-${randomUUID()}`;
    expect(await acquireLock(SCAN_LOCK_KEY, token, 30)).toBe(true);
    expect(await acquireLock(SCAN_LOCK_KEY, `other-${token}`, 30)).toBe(false);
    expect(await renewLock(SCAN_LOCK_KEY, token, 30)).toBe(true);
    expect(await renewLock(SCAN_LOCK_KEY, `other-${token}`, 30)).toBe(false);
    await releaseLock(SCAN_LOCK_KEY, token);
    expect(await acquireLock(SCAN_LOCK_KEY, token, 30)).toBe(true);
    await releaseLock(SCAN_LOCK_KEY, token);
  });

  it('does not start cleanup when another execution holds the lock', async () => {
    const workId = await insertWork();
    const orphan = `orphan/${workId}/locked.mp3`;
    await putObject(orphan, 9);

    const scan = await app.request('/api/admin/assets/scan', {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    const report = assetScanReportSchema.parse(await scan.json());
    const holder = `execution-${randomUUID()}`;
    expect(await acquireLock(CLEANUP_LOCK_KEY, holder, 30)).toBe(true);
    try {
      const accepted = await enqueueCleanup(report.scanId);
      await expect(processAssetCleanup({ jobId: accepted.jobId, scanId: accepted.scanId })).rejects.toThrow(
        'Another cleanup job holds the cleanup lock',
      );

      const blocked = await loadCleanupJob(accepted.jobId);
      expect(blocked?.pendingKeys).toContain(orphan);
      expect(blocked?.status).toBe('queued');
      expect(memory.store.has(orphan)).toBe(true);
    } finally {
      await releaseLock(CLEANUP_LOCK_KEY, holder);
    }
  });

  it('retries both failed and remaining pending keys without exceeding requestedCount', async () => {
    const workId = await insertWork();
    const failedKey = `orphan/${workId}/retry-fail.mp3`;
    const pendingKey = `orphan/${workId}/retry-pending.mp3`;
    const doneKey = `orphan/${workId}/retry-done.mp3`;
    await putObject(failedKey, 8);
    await putObject(pendingKey, 8);
    await putObject(doneKey, 8);

    const scan = await app.request('/api/admin/assets/scan', {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    const report = assetScanReportSchema.parse(await scan.json());
    const accepted = await withCleanupLockHeld(async () => {
      const queued = await enqueueCleanup(report.scanId);
      const record = await loadCleanupJob(queued.jobId);
      expect(record).not.toBeNull();
      if (!record) {
        throw new Error('expected cleanup job record');
      }

      record.status = 'partial';
      record.requestedCount = 3;
      record.processedCount = 2;
      record.deletedCount = 1;
      record.deletedBytes = 8;
      record.failed = [{ key: failedKey, error: 'simulated' }];
      record.failedCount = 1;
      record.pendingKeys = [pendingKey];
      await memory.delete(doneKey);
      await saveCleanupJob(record);

      const retry = await app.request(`/api/admin/assets/cleanup-jobs/${encodeURIComponent(queued.jobId)}/retry`, {
        method: 'POST',
        headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      });
      expect(retry.status).toBe(HTTP_STATUS.ACCEPTED);

      const retried = await loadCleanupJob(queued.jobId);
      expect(retried).not.toBeNull();
      if (!retried) {
        throw new Error('expected retried cleanup job record');
      }
      expect(retried.pendingKeys.sort()).toEqual([failedKey, pendingKey].sort());
      expect(retried.failed).toEqual([]);
      expect(retried.requestedCount).toBe(3);
      expect(retried.processedCount).toBe(1);
      expect(retried.processedCount).toBeLessThanOrEqual(retried.requestedCount);
      expect(retried.deletedCount).toBe(1);
      return queued;
    });

    await processAssetCleanup({ jobId: accepted.jobId, scanId: accepted.scanId });
    const finished = assetCleanupJobSchema.parse(
      await (
        await app.request(`/api/admin/assets/cleanup-jobs/${encodeURIComponent(accepted.jobId)}`, {
          headers: { Cookie: adminCookie },
        })
      ).json(),
    );
    expect(finished.processedCount).toBeLessThanOrEqual(finished.requestedCount);
    expect(finished.requestedCount).toBe(3);
    expect(memory.store.has(failedKey)).toBe(false);
    expect(memory.store.has(pendingKey)).toBe(false);
  });

  it('marks cleanup partial when verification still finds orphans', async () => {
    const workId = await insertWork();
    const scannedOrphan = `orphan/${workId}/scanned.mp3`;
    const leftover = `orphan/${workId}/leftover.mp3`;
    await putObject(scannedOrphan, 7);

    const scan = await app.request('/api/admin/assets/scan', {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    const report = assetScanReportSchema.parse(await scan.json());
    const accepted = await withCleanupLockHeld(async () => {
      const queued = await enqueueCleanup(report.scanId);
      await putObject(leftover, 7);
      return queued;
    });

    await processAssetCleanup({ jobId: accepted.jobId, scanId: accepted.scanId });

    const job = assetCleanupJobSchema.parse(
      await (
        await app.request(`/api/admin/assets/cleanup-jobs/${encodeURIComponent(accepted.jobId)}`, {
          headers: { Cookie: adminCookie },
        })
      ).json(),
    );
    expect(job.status).toBe('partial');
    expect(job.verification?.ran).toBe(true);
    expect(job.verification?.scanComplete).toBe(true);
    expect(job.verification?.orphanCount).toBeGreaterThanOrEqual(1);
    expect(memory.store.has(scannedOrphan)).toBe(false);
    expect(memory.store.has(leftover)).toBe(true);
  });

  it('resumes remaining pending keys after a worker restart', async () => {
    const workId = await insertWork();
    const first = `orphan/${workId}/first.mp3`;
    const second = `orphan/${workId}/second.mp3`;
    await putObject(first, 11);
    await putObject(second, 12);

    const scan = await app.request('/api/admin/assets/scan', {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    const report = assetScanReportSchema.parse(await scan.json());
    const accepted = await withCleanupLockHeld(async () => {
      const queued = await enqueueCleanup(report.scanId);
      const record = await loadCleanupJob(queued.jobId);
      expect(record).not.toBeNull();
      if (!record) {
        throw new Error('expected cleanup job record');
      }

      record.pendingKeys = record.pendingKeys.filter((key) => key !== first);
      record.processedCount += 1;
      record.deletedCount += 1;
      record.deletedBytes += 11;
      record.status = 'running';
      await memory.delete(first);
      await saveCleanupJob(record);
      return queued;
    });

    await processAssetCleanup({ jobId: accepted.jobId, scanId: accepted.scanId });
    expect(memory.store.has(first)).toBe(false);
    expect(memory.store.has(second)).toBe(false);

    const job = assetCleanupJobSchema.parse(
      await (
        await app.request(`/api/admin/assets/cleanup-jobs/${encodeURIComponent(accepted.jobId)}`, {
          headers: { Cookie: adminCookie },
        })
      ).json(),
    );
    expect(job.status).toBe('completed');
  });
});
