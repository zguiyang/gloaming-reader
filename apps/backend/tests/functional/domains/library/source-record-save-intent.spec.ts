import { randomUUID } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  readingState as readingStateTable,
  readingWork as readingWorkTable,
  user as userTable,
  userLibraryItem as userLibraryItemTable,
  userWorkTag as userWorkTagTable,
} from '@gloaming/db';
import {
  discoverySource as discoverySourceTable,
  sourceRecord as sourceRecordTable,
  sourceRecordSaveIntent as saveIntentTable,
} from '@gloaming/db/schema';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';
import type { LibraryData } from '@gloaming/shared/library';

import app from '@/app';
import { classifyMaterializationFailure } from '@/application/jobs/source-record-materialize';
import { GutenbergEpubDownloadError } from '@/domains/discovery/materialization/download';
import {
  failPendingSaveIntents,
  fanOutReadySaveIntentsForSourceRecord,
  fanOutReadySaveIntentsForWork,
  saveSourceRecordToLibrary,
} from '@/domains/library/save-intent';
import { db } from '@/infra/db';
import * as queueLib from '@/infra/queue';
import { HTTP_STATUS } from '@/shared/constants';

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

/**
 * Deterministically reproduce the stale-link race in `saveSourceRecordToLibrary`:
 * let the pre-upsert `loadSavableSourceRecord` read the SourceRecord with
 * `work_id = NULL`, then link (and mark ready) the Work before the post-upsert
 * decision. Implemented by wrapping the first awaited drizzle `select` so the
 * link is committed right after that stale read resolves.
 */
function injectLinkAfterStaleRead(sourceRecordId: string, workId: string): () => void {
  const dbWithSelect = db as unknown as { select: typeof db.select };
  const realSelect = db.select;
  let injected = false;

  const wrap = (target: object): object =>
    new Proxy(target, {
      get(raw, prop) {
        const value = Reflect.get(raw, prop, raw);
        if (prop === 'then' && typeof value === 'function') {
          return (onFulfilled: (rows: unknown) => unknown, onRejected?: (error: unknown) => unknown) =>
            (value as (...args: unknown[]) => Promise<unknown>).call(
              raw,
              async (rows: unknown) => {
                if (!injected) {
                  injected = true;
                  await db
                    .update(sourceRecordTable)
                    .set({ workId, materializationStatus: 'ready' })
                    .where(eq(sourceRecordTable.id, sourceRecordId));
                }
                return onFulfilled(rows);
              },
              onRejected,
            );
        }
        if (typeof value === 'function') {
          return (...args: unknown[]) => {
            const result = (value as (...innerArgs: unknown[]) => unknown).apply(raw, args);
            return result !== null && typeof result === 'object' ? wrap(result) : result;
          };
        }
        return value;
      },
    });

  dbWithSelect.select = ((fields: unknown) => wrap(realSelect.call(db, fields as never))) as typeof db.select;
  return () => {
    dbWithSelect.select = realSelect;
  };
}

describe('SourceRecord save intent + lazy materialization on gloaming_test', () => {
  const runId = randomUUID();
  const createdEmails: string[] = [];
  const createdWorkIds: string[] = [];
  let sourceId = '';
  let enqueueSpy: ReturnType<typeof vi.spyOn<typeof queueLib, 'enqueue'>>;

  function track<T extends { email: string }>(session: T): T {
    createdEmails.push(session.email);
    return session;
  }

  async function createRecord(overrides: Partial<typeof sourceRecordTable.$inferInsert> = {}) {
    const id = randomUUID();
    await db.insert(sourceRecordTable).values({
      id,
      sourceId,
      externalId: `${runId}-${id}`,
      title: 'Save Intent Record',
      authors: [{ name: 'Author' }],
      languages: ['en'],
      contentCandidates: [{ format: 'epub', url: `https://www.gutenberg.org/cache/epub/1/pg1.epub.images` }],
      availability: 'available',
      materializationStatus: 'not_materialized',
      ...overrides,
    });
    return { id };
  }

  async function intentsFor(sourceRecordId: string) {
    return db.select().from(saveIntentTable).where(eq(saveIntentTable.sourceRecordId, sourceRecordId));
  }

  async function membershipCount(userId: string, workId: string) {
    const rows = await db
      .select({ id: userLibraryItemTable.id })
      .from(userLibraryItemTable)
      .where(and(eq(userLibraryItemTable.userId, userId), eq(userLibraryItemTable.workId, workId)));
    return rows.length;
  }

  async function markWorkReady(workId: string) {
    await db.update(readingWorkTable).set({ processingStatus: 'ready' }).where(eq(readingWorkTable.id, workId));
  }

  beforeAll(async () => {
    sourceId = randomUUID();
    await db.insert(discoverySourceTable).values({
      id: sourceId,
      sourceKey: `save_intent_test_${runId}`,
      sourceType: 'gutenberg_rdf',
    });
    enqueueSpy = vi.spyOn(queueLib, 'enqueue').mockResolvedValue('save-intent-test-job');
  });

  beforeEach(() => {
    enqueueSpy.mockClear();
    enqueueSpy.mockResolvedValue('save-intent-test-job');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });
  afterAll(async () => {
    enqueueSpy?.mockRestore();
    if (createdWorkIds.length) {
      await db.delete(readingWorkTable).where(inArray(readingWorkTable.id, createdWorkIds));
    }
    await db.delete(discoverySourceTable).where(eq(discoverySourceTable.id, sourceId));
    for (const email of createdEmails) {
      await db.delete(userTable).where(eq(userTable.email, email));
    }
  });

  it('enforces one intent per (user, source_record) at the database level', async () => {
    const learner = track(await createSession());
    const record = await createRecord();
    await db
      .insert(saveIntentTable)
      .values({ id: randomUUID(), userId: learner.userId, sourceRecordId: record.id, status: 'pending' });
    await expect(
      db
        .insert(saveIntentTable)
        .values({ id: randomUUID(), userId: learner.userId, sourceRecordId: record.id, status: 'pending' }),
    ).rejects.toThrow();
  });

  it('creates a pending intent and enqueues the materialization job without membership', async () => {
    const learner = track(await createSession());
    const record = await createRecord();

    const result = await saveSourceRecordToLibrary(learner.userId, record.id);

    expect(result).toEqual({ status: 'pending', workId: null });
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy.mock.calls[0]![0]).toBe('source-record-materialize');
    expect(enqueueSpy.mock.calls[0]![1]).toEqual({ sourceRecordId: record.id });

    const intents = await intentsFor(record.id);
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ userId: learner.userId, status: 'pending' });
    const memberships = await db
      .select({ id: userLibraryItemTable.id })
      .from(userLibraryItemTable)
      .where(eq(userLibraryItemTable.userId, learner.userId));
    expect(memberships).toHaveLength(0);
  });

  it('is idempotent per (user, source_record): repeated saves keep one intent', async () => {
    const learner = track(await createSession());
    const record = await createRecord();

    await saveSourceRecordToLibrary(learner.userId, record.id);
    await saveSourceRecordToLibrary(learner.userId, record.id);
    await saveSourceRecordToLibrary(learner.userId, record.id);

    expect(await intentsFor(record.id)).toHaveLength(1);
  });

  it('rejects disabled sources and unavailable records without creating an intent', async () => {
    const learner = track(await createSession());
    const disabledSourceId = randomUUID();
    await db.insert(discoverySourceTable).values({
      id: disabledSourceId,
      sourceKey: `save_intent_disabled_${runId}`,
      sourceType: 'gutenberg_rdf',
      enabled: false,
    });
    const disabledRecordId = randomUUID();
    await db.insert(sourceRecordTable).values({
      id: disabledRecordId,
      sourceId: disabledSourceId,
      externalId: `${runId}-disabled`,
      title: 'Disabled',
      availability: 'available',
      materializationStatus: 'not_materialized',
    });
    const unavailable = await createRecord({ availability: 'unavailable' });

    const disabledResponse = await app.request(`/api/library/source-records/${disabledRecordId}`, {
      method: 'POST',
      headers: { cookie: learner.cookie },
    });
    expect(disabledResponse.status).toBe(HTTP_STATUS.NOT_FOUND);

    await expect(saveSourceRecordToLibrary(learner.userId, unavailable.id)).rejects.toMatchObject({
      statusCode: HTTP_STATUS.NOT_FOUND,
    });

    expect(await intentsFor(disabledRecordId)).toHaveLength(0);
    expect(await intentsFor(unavailable.id)).toHaveLength(0);
    expect(enqueueSpy).not.toHaveBeenCalled();
    await db.delete(discoverySourceTable).where(eq(discoverySourceTable.id, disabledSourceId));
  });

  it('completes immediately with membership when the linked Work is already readable', async () => {
    const learner = track(await createSession());
    const work = await createCatalogWorkFixture({ title: 'Ready Source Work', publishedAt: null });
    createdWorkIds.push(work.id);
    const record = await createRecord({ workId: work.id, materializationStatus: 'ready' });

    const result = await saveSourceRecordToLibrary(learner.userId, record.id);

    expect(result).toEqual({ status: 'ready', workId: work.id });
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(await membershipCount(learner.userId, work.id)).toBe(1);
    expect((await intentsFor(record.id))[0]?.status).toBe('completed');
  });

  it('revives a failed intent to pending and safely re-enqueues on retry', async () => {
    const learner = track(await createSession());
    const record = await createRecord();
    await db.insert(saveIntentTable).values({
      id: randomUUID(),
      userId: learner.userId,
      sourceRecordId: record.id,
      status: 'failed',
      failureCode: 'download_http_error',
      failureReason: 'upstream returned an error page',
    });

    const result = await saveSourceRecordToLibrary(learner.userId, record.id);

    expect(result.status).toBe('pending');
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    const intents = await intentsFor(record.id);
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ status: 'pending', failureCode: null, failureReason: null });
  });

  it('fans out one shared Work to multiple users with one membership each', async () => {
    const first = track(await createSession());
    const second = track(await createSession());
    const work = await createCatalogWorkFixture({
      title: 'Shared Source Work',
      processingStatus: 'processing',
      publishedAt: null,
    });
    createdWorkIds.push(work.id);
    const record = await createRecord({ workId: work.id, materializationStatus: 'processing' });

    await saveSourceRecordToLibrary(first.userId, record.id);
    await saveSourceRecordToLibrary(second.userId, record.id);
    expect((await intentsFor(record.id)).map((intent) => intent.status)).toEqual(['pending', 'pending']);

    await markWorkReady(work.id);
    await fanOutReadySaveIntentsForWork(work.id);

    const linked = await db.select().from(userLibraryItemTable).where(eq(userLibraryItemTable.workId, work.id));
    expect(linked).toHaveLength(2);
    expect(new Set(linked.map((row) => row.workId))).toEqual(new Set([work.id]));
    expect((await intentsFor(record.id)).every((intent) => intent.status === 'completed')).toBe(true);
  });

  it('completes a late intent that arrives after the fan-out already ran', async () => {
    const first = track(await createSession());
    const late = track(await createSession());
    const work = await createCatalogWorkFixture({ title: 'Late Intent Work', publishedAt: null });
    createdWorkIds.push(work.id);
    const record = await createRecord({ workId: work.id, materializationStatus: 'ready' });

    await saveSourceRecordToLibrary(first.userId, record.id);
    // A late save must observe the committed link and not stay pending.
    const lateResult = await saveSourceRecordToLibrary(late.userId, record.id);

    expect(lateResult).toEqual({ status: 'ready', workId: work.id });
    expect(await membershipCount(late.userId, work.id)).toBe(1);
    expect((await intentsFor(record.id)).every((intent) => intent.status === 'completed')).toBe(true);
    await fanOutReadySaveIntentsForSourceRecord(record.id);
  });

  it('completes a save from a stale workId=null read once the record is linked during the upsert', async () => {
    const learner = track(await createSession());
    const work = await createCatalogWorkFixture({ title: 'Stale Link Race Work', publishedAt: null });
    createdWorkIds.push(work.id);
    // The record starts unlinked, so the pre-upsert read captures workId = null.
    const record = await createRecord();

    const restore = injectLinkAfterStaleRead(record.id, work.id);
    let result: Awaited<ReturnType<typeof saveSourceRecordToLibrary>>;
    try {
      result = await saveSourceRecordToLibrary(learner.userId, record.id);
    } finally {
      restore();
    }

    // The post-upsert re-read must observe the newly linked readable Work and
    // complete the intent immediately, with no materialization job needed.
    expect(result!).toEqual({ status: 'ready', workId: work.id });
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(await membershipCount(learner.userId, work.id)).toBe(1);
    expect((await intentsFor(record.id))[0]?.status).toBe('completed');
  });

  it('marks pending intents failed with a cleaned reason and never creates membership', async () => {
    const learner = track(await createSession());
    const work = await createCatalogWorkFixture({
      title: 'Failed Source Work',
      processingStatus: 'processing',
      publishedAt: null,
    });
    createdWorkIds.push(work.id);
    const record = await createRecord({ workId: work.id, materializationStatus: 'processing' });
    await saveSourceRecordToLibrary(learner.userId, record.id);

    await failPendingSaveIntents(record.id, { code: 'download_timeout', reason: 'download timed out after 30000ms' });

    const intents = await intentsFor(record.id);
    expect(intents[0]).toMatchObject({ status: 'failed', failureCode: 'download_timeout' });
    expect(intents[0]?.failureReason).toBe('download timed out after 30000ms');
    expect(await membershipCount(learner.userId, work.id)).toBe(0);
  });

  it('classifies a download failure into a short cleaned failure code', () => {
    const failure = classifyMaterializationFailure(new GutenbergEpubDownloadError('http_error', 'HTTP 502 for EPUB'));
    expect(failure).toEqual({ code: 'download_http_error', reason: 'HTTP 502 for EPUB' });
  });

  it('hides pending intents from GET /api/library and re-adds membership after removal', async () => {
    const learner = track(await createSession());
    const work = await createCatalogWorkFixture({
      title: 'Library Membership Work',
      processingStatus: 'processing',
      publishedAt: null,
    });
    createdWorkIds.push(work.id);
    const record = await createRecord({ workId: work.id, materializationStatus: 'processing' });

    const pendingSave = await app.request(`/api/library/source-records/${record.id}`, {
      method: 'POST',
      headers: { cookie: learner.cookie },
    });
    expect(pendingSave.status).toBe(200);
    expect(((await pendingSave.json()) as { status: string }).status).toBe('pending');

    const hidden = (await (
      await app.request('/api/library', { headers: { cookie: learner.cookie } })
    ).json()) as LibraryData;
    expect(hidden.items).toEqual([]);

    await markWorkReady(work.id);
    await fanOutReadySaveIntentsForWork(work.id);
    const saved = (await (
      await app.request('/api/library', { headers: { cookie: learner.cookie } })
    ).json()) as LibraryData;
    expect(saved.items.map((item) => item.work.id)).toContain(work.id);

    await db
      .delete(userLibraryItemTable)
      .where(and(eq(userLibraryItemTable.userId, learner.userId), eq(userLibraryItemTable.workId, work.id)));

    const reSave = await app.request(`/api/library/source-records/${record.id}`, {
      method: 'POST',
      headers: { cookie: learner.cookie },
    });
    expect(((await reSave.json()) as { status: string }).status).toBe('ready');
    expect(await membershipCount(learner.userId, work.id)).toBe(1);
  });

  it('lets only members read an unpublished ownerless Source Work', async () => {
    const member = track(await createSession());
    const outsider = track(await createSession());
    const admin = track(await createSession('admin'));
    const work = await createCatalogWorkFixture({ title: 'Member Only Source Work', publishedAt: null });
    createdWorkIds.push(work.id);
    await createRecord({ workId: work.id, materializationStatus: 'ready' });
    await db.insert(userLibraryItemTable).values({ id: randomUUID(), userId: member.userId, workId: work.id });

    async function readerParts(cookie?: string) {
      return app.request(`/api/reader/works/${work.id}/parts`, cookie ? { headers: { Cookie: cookie } } : undefined);
    }

    expect((await readerParts(member.cookie)).status).toBe(200);
    expect((await readerParts(outsider.cookie)).status).toBe(HTTP_STATUS.NOT_FOUND);
    expect((await readerParts(admin.cookie)).status).toBe(HTTP_STATUS.NOT_FOUND);
    expect(await readerParts()).toMatchObject({ status: HTTP_STATUS.NOT_FOUND });

    const [row] = await db
      .select({ publishedAt: readingWorkTable.publishedAt })
      .from(readingWorkTable)
      .where(eq(readingWorkTable.id, work.id));
    expect(row?.publishedAt).toBeNull();
  });

  it('exposes the public SourceRecord id Save API only to authenticated users', async () => {
    const record = await createRecord();
    const anonymous = await app.request(`/api/library/source-records/${record.id}`, { method: 'POST' });
    expect(anonymous.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });

  it('cascades intents when the user is deleted', async () => {
    const learner = track(await createSession());
    const record = await createRecord();
    await saveSourceRecordToLibrary(learner.userId, record.id);
    expect(await intentsFor(record.id)).toHaveLength(1);
    await db.delete(userTable).where(eq(userTable.id, learner.userId));
    expect(await intentsFor(record.id)).toHaveLength(0);
  });

  it('links a materialized Work without touching ReadingState or user tags', async () => {
    const learner = track(await createSession());
    const work = await createCatalogWorkFixture({ title: 'Source Work No State', publishedAt: null });
    createdWorkIds.push(work.id);
    const record = await createRecord({ workId: work.id, materializationStatus: 'ready' });

    await saveSourceRecordToLibrary(learner.userId, record.id);

    const states = await db
      .select({ id: readingStateTable.id })
      .from(readingStateTable)
      .where(and(eq(readingStateTable.userId, learner.userId), eq(readingStateTable.workId, work.id)));
    expect(states).toHaveLength(0);
    const tags = await db
      .select({ tagId: userWorkTagTable.tagId })
      .from(userWorkTagTable)
      .where(and(eq(userWorkTagTable.userId, learner.userId), eq(userWorkTagTable.workId, work.id)));
    expect(tags).toHaveLength(0);
  });
});
