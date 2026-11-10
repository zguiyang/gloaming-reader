import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { contentAsset as contentAssetTable, readingWork as readingWorkTable, user as userTable } from '@gloaming/db';

import {
  JOB_WORK_COVER_REFRESH,
  processWorkCoverRefresh,
  WORK_COVER_MAX_BYTES,
  type WorkCoverRefreshJobData,
  workCoverRefreshJobId,
} from '@/application/jobs/work-cover-refresh';
import { sha256 } from '@/domains/ingest/parser/parse-artifacts';
import { db } from '@/infra/db';
import { closeQueue, enqueueWorkCoverRefresh, getQueue } from '@/infra/queue';
import { resetObjectStoreCache, setObjectStoreForTests } from '@/infra/storage';

import { createMemoryObjectStore } from '../../../helpers/memory-oss';

const COVER_URL = 'https://www.gutenberg.org/covers/work-cover-refresh-fixture.gif';
const LEGACY_COVER_BYTES = Buffer.from('legacy-cover-bytes');

const objectStore = createMemoryObjectStore();
const fetchMock = vi.fn();
const createdWorkIds: string[] = [];
let personalUserId = '';

type WorkFixture = {
  workId: string;
  coverAssetId: string;
  coverStorageKey: string;
};

/** Materialized catalog Work with one legacy EPUB-style cover asset and object. */
async function createWorkFixture(
  options: { ownerUserId?: string | null; processingStatus?: string; sourceCoverUrl?: string | null } = {},
): Promise<WorkFixture> {
  const workId = randomUUID();
  const coverAssetId = randomUUID();
  const coverStorageKey = `covers/${workId}/legacy/legacy.jpg`;
  const originMeta = options.sourceCoverUrl ? { sourceCoverUrl: options.sourceCoverUrl } : {};
  await db.insert(readingWorkTable).values({
    id: workId,
    title: 'Cover refresh fixture work',
    author: 'Cover Fixture Author',
    description: '',
    language: 'en',
    processingStatus: options.processingStatus ?? 'ready',
    ownerUserId: options.ownerUserId ?? null,
    visibility: 'catalog',
    originMeta,
    coverAssetId,
  });
  await db.insert(contentAssetTable).values({
    id: coverAssetId,
    workId,
    kind: 'cover',
    storageKey: coverStorageKey,
    mimeType: 'image/jpeg',
    contentHash: sha256(LEGACY_COVER_BYTES),
    meta: {},
    status: 'ready',
  });
  await objectStore.put({ key: coverStorageKey, body: LEGACY_COVER_BYTES, contentType: 'image/jpeg' });
  createdWorkIds.push(workId);
  return { workId, coverAssetId, coverStorageKey };
}

async function workRow(workId: string) {
  const [row] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId)).limit(1);
  return row;
}

async function coverRows(workId: string) {
  return db
    .select()
    .from(contentAssetTable)
    .where(and(eq(contentAssetTable.workId, workId), eq(contentAssetTable.kind, 'cover')));
}

async function expectCoverUntouched(fixture: WorkFixture): Promise<void> {
  const work = await workRow(fixture.workId);
  expect(work?.coverAssetId).toBe(fixture.coverAssetId);
  expect((await coverRows(fixture.workId)).map((row) => row.id)).toEqual([fixture.coverAssetId]);
  expect(objectStore.store.has(fixture.coverStorageKey)).toBe(true);
}

function imageResponse(body: Buffer, contentType = 'image/gif', headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers: { 'content-type': contentType, ...headers } });
}

function pendingUntilAborted(signal?: AbortSignal | null): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => {
      const error = new Error('This operation was aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });
}

describe('work-cover-refresh job', () => {
  beforeAll(() => {
    setObjectStoreForTests(objectStore);
  });

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    resetObjectStoreCache();
    for (const workId of createdWorkIds) {
      await db.delete(readingWorkTable).where(eq(readingWorkTable.id, workId));
    }
    if (personalUserId) {
      await db.delete(userTable).where(eq(userTable.id, personalUserId));
    }
    await closeQueue();
  });

  it('stores the downloaded cover, points the Work at it, and drops the previous cover row', async () => {
    const fixture = await createWorkFixture();
    const bytes = Buffer.from('GIF89a-source-cover-fixture');
    fetchMock.mockResolvedValue(imageResponse(bytes));

    const result = await processWorkCoverRefresh({ workId: fixture.workId, sourceCoverUrl: COVER_URL });

    expect(result).toMatchObject({ ok: true, outcome: 'updated', workId: fixture.workId });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(COVER_URL);

    const covers = await coverRows(fixture.workId);
    expect(covers).toHaveLength(1);
    const cover = covers[0]!;
    expect(cover.id).not.toBe(fixture.coverAssetId);
    expect(cover.storageKey).not.toBe(fixture.coverStorageKey);
    expect(cover.contentHash).toBe(sha256(bytes));
    expect(cover.mimeType).toBe('image/gif');
    expect(cover.meta).toMatchObject({ sourceUrl: COVER_URL, transform: 'none' });
    expect(objectStore.store.get(cover.storageKey)).toMatchObject({ contentType: 'image/gif' });

    const work = await workRow(fixture.workId);
    expect(work?.coverAssetId).toBe(cover.id);
    expect(work?.originMeta).toMatchObject({ sourceCoverUrl: COVER_URL });

    // Superseded row goes; its object is left for the existing asset-cleanup job.
    expect(objectStore.store.has(fixture.coverStorageKey)).toBe(true);
  });

  it('runs through the shared worker dispatch for its job name', async () => {
    const { processJob } = await import('@/worker');
    const fixture = await createWorkFixture();
    fetchMock.mockResolvedValue(imageResponse(Buffer.from('GIF89a-dispatch-cover')));
    const data: WorkCoverRefreshJobData = { workId: fixture.workId, sourceCoverUrl: COVER_URL };

    await expect(processJob({ name: JOB_WORK_COVER_REFRESH, data })).resolves.toMatchObject({ outcome: 'updated' });
    expect((await workRow(fixture.workId))?.originMeta).toMatchObject({ sourceCoverUrl: COVER_URL });
  });

  it('is a no-op when the Work already records this source cover', async () => {
    const fixture = await createWorkFixture({ sourceCoverUrl: COVER_URL });

    const result = await processWorkCoverRefresh({ workId: fixture.workId, sourceCoverUrl: COVER_URL });

    expect(result).toMatchObject({ outcome: 'skipped', reason: 'unchanged' });
    expect(fetchMock).not.toHaveBeenCalled();
    await expectCoverUntouched(fixture);
  });

  it('never overwrites a personal Work', async () => {
    personalUserId = personalUserId || randomUUID();
    if (!(await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.id, personalUserId)).limit(1))[0]) {
      await db.insert(userTable).values({
        id: personalUserId,
        name: 'Cover Refresh Personal User',
        email: `${personalUserId}@example.com`,
      });
    }
    const fixture = await createWorkFixture({ ownerUserId: personalUserId });

    const result = await processWorkCoverRefresh({ workId: fixture.workId, sourceCoverUrl: COVER_URL });

    expect(result).toMatchObject({ outcome: 'skipped', reason: 'personal_work' });
    expect(fetchMock).not.toHaveBeenCalled();
    await expectCoverUntouched(fixture);
  });

  it('is a no-op for a failed or missing Work', async () => {
    const failed = await createWorkFixture({ processingStatus: 'failed' });
    expect(await processWorkCoverRefresh({ workId: failed.workId, sourceCoverUrl: COVER_URL })).toMatchObject({
      outcome: 'skipped',
      reason: 'work_failed',
    });
    expect(await processWorkCoverRefresh({ workId: randomUUID(), sourceCoverUrl: COVER_URL })).toMatchObject({
      outcome: 'skipped',
      reason: 'work_missing',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await expectCoverUntouched(failed);
  });

  it('rejects a non-image response and keeps the stored cover', async () => {
    const fixture = await createWorkFixture();
    fetchMock.mockResolvedValue(
      new Response('<html>404</html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
    );

    await expect(processWorkCoverRefresh({ workId: fixture.workId, sourceCoverUrl: COVER_URL })).rejects.toMatchObject({
      name: 'WorkCoverRefreshError',
      code: 'unexpected_content',
    });
    expect((await workRow(fixture.workId))?.originMeta).toEqual({});
    await expectCoverUntouched(fixture);
  });

  it('rejects an oversized cover and keeps the stored cover', async () => {
    const fixture = await createWorkFixture();
    fetchMock.mockResolvedValue(imageResponse(Buffer.alloc(WORK_COVER_MAX_BYTES + 1, 0x41)));

    await expect(processWorkCoverRefresh({ workId: fixture.workId, sourceCoverUrl: COVER_URL })).rejects.toMatchObject({
      name: 'WorkCoverRefreshError',
      code: 'too_large',
    });
    await expectCoverUntouched(fixture);
  });

  it('rejects a download that exceeds its time budget and keeps the stored cover', async () => {
    const fixture = await createWorkFixture();
    fetchMock.mockImplementation((_input: unknown, init?: RequestInit) => pendingUntilAborted(init?.signal));

    await expect(
      processWorkCoverRefresh({ workId: fixture.workId, sourceCoverUrl: COVER_URL }, { timeoutMs: 25 }),
    ).rejects.toMatchObject({ name: 'WorkCoverRefreshError', code: 'timeout' });
    expect((await workRow(fixture.workId))?.originMeta).toEqual({});
    await expectCoverUntouched(fixture);
  });

  it('refuses private-network and non-HTTPS cover URLs without fetching', async () => {
    const fixture = await createWorkFixture();

    for (const sourceCoverUrl of [
      'https://127.0.0.1/cover.gif',
      'http://www.gutenberg.org/covers/cover.gif',
      'https://localhost/cover.gif',
      'file:///etc/passwd',
    ]) {
      await expect(processWorkCoverRefresh({ workId: fixture.workId, sourceCoverUrl })).rejects.toMatchObject({
        name: 'WorkCoverRefreshError',
        code: 'unsafe_url',
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
    await expectCoverUntouched(fixture);
  });

  it('enqueues on the gloaming queue with a deduplicating work+cover job id', async () => {
    const workId = randomUUID();
    const sourceCoverUrl = `https://www.gutenberg.org/covers/${workId}.gif`;
    const jobId = workCoverRefreshJobId(workId, sourceCoverUrl);
    const queue = getQueue();

    try {
      const first = await enqueueWorkCoverRefresh({ workId, sourceCoverUrl }, { attempts: 2, jobId });
      expect(first).toBe(jobId);

      const job = await queue.getJob(jobId);
      expect(job).toBeDefined();
      expect(job?.name).toBe(JOB_WORK_COVER_REFRESH);
      expect(job?.queueName).toBe(queue.name);
      expect(job?.opts.attempts).toBe(2);

      // Same work + same cover URL → same job id, so a repeat sync cannot double-queue.
      const second = await enqueueWorkCoverRefresh({ workId, sourceCoverUrl }, { attempts: 2, jobId });
      expect(second).toBe(jobId);
      await job?.remove();
    } finally {
      const leftover = await queue.getJob(jobId);
      await leftover?.remove().catch(() => undefined);
    }
  });
});
