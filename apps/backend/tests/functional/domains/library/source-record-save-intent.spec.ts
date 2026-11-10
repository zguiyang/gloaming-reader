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
  recoverStaleSaveIntents,
  SAVE_INTENT_REENQUEUE_AFTER_MS,
  SAVE_INTENT_TIMEOUT_AFTER_MS,
  saveSourceRecordToLibrary,
} from '@/domains/library/save-intent';
import { removeFromLibrary } from '@/domains/library/service';
import { db } from '@/infra/db';
import * as queueLib from '@/infra/queue';
import { HTTP_STATUS } from '@/shared/constants';
import { ERROR_CODES } from '@/shared/errors/codes';

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

/**
 * Unique TEST-NET-2 client IP per session: without it every signup/login of
 * this spec shares the guest API limiter's single `unknown` bucket
 * (60 requests / 60s / IP) and the file rate-limits itself past ~27 sessions.
 */
let sessionIpCursor = 0;
function uniqueClientIp(): string {
  sessionIpCursor = (sessionIpCursor % 254) + 1;
  return `198.51.100.${sessionIpCursor}`;
}

async function createSession(role: 'user' | 'admin' = 'user') {
  const email = uniqueEmail(role);
  const username = `${role}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const clientIp = uniqueClientIp();
  const clientHeaders = {
    'Content-Type': 'application/json',
    Origin: 'http://localhost:3000',
    'x-real-ip': clientIp,
    'x-forwarded-for': clientIp,
  };
  const signup = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: clientHeaders,
    body: JSON.stringify({ email, password, name: role, username }),
  });
  expect(signup.status).toBe(200);
  await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.email, email));
  if (role === 'admin') {
    await db.update(userTable).set({ role: AUTH_ADMIN_ROLE }).where(eq(userTable.email, email));
  }
  const login = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: clientHeaders,
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
  let enqueueSpy: ReturnType<typeof vi.spyOn<typeof queueLib, 'enqueueDiscoveryImport'>>;

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

  /** Backdate a pending intent's timestamps to simulate a lost materialization job. */
  async function insertStalePendingIntent(userId: string, sourceRecordId: string, ageMs: number) {
    await db.insert(saveIntentTable).values({
      id: randomUUID(),
      userId,
      sourceRecordId,
      status: 'pending',
    });
    const staleAt = new Date(Date.now() - ageMs);
    await db
      .update(saveIntentTable)
      .set({ createdAt: staleAt, updatedAt: staleAt })
      .where(and(eq(saveIntentTable.userId, userId), eq(saveIntentTable.sourceRecordId, sourceRecordId)));
    return staleAt;
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
    enqueueSpy = vi.spyOn(queueLib, 'enqueueDiscoveryImport').mockResolvedValue('save-intent-test-job');
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
    // BullMQ rejects custom job ids containing ":" — the id must stay hyphenated.
    const enqueueOptions = enqueueSpy.mock.calls[0]![2] as { jobId?: string };
    expect(enqueueOptions.jobId).toBe(`source-record-materialize-${record.id}`);
    expect(enqueueOptions.jobId).not.toContain(':');

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

  it('stays idempotent under concurrent saves: one intent and one deterministic job id', async () => {
    const learner = track(await createSession());
    const record = await createRecord();

    const results = await Promise.all([
      saveSourceRecordToLibrary(learner.userId, record.id),
      saveSourceRecordToLibrary(learner.userId, record.id),
      saveSourceRecordToLibrary(learner.userId, record.id),
    ]);

    expect(results.map((result) => result.status)).toEqual(['pending', 'pending', 'pending']);
    expect(await intentsFor(record.id)).toHaveLength(1);
    const jobIds = enqueueSpy.mock.calls.map((call) => (call[2] as { jobId: string }).jobId);
    expect(jobIds.length).toBeGreaterThan(0);
    expect(new Set(jobIds)).toEqual(new Set([`source-record-materialize-${record.id}`]));
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

  it('rejects a record with no selectable EPUB candidate before creating, reviving, or enqueueing anything', async () => {
    const learner = track(await createSession());
    // Synced but unusable metadata: HTML and a third-party EPUB URL are both
    // rejected by the same pure predicate behind Discover's `isSaveable` flag.
    const noCandidate = await createRecord({
      contentCandidates: [
        { format: 'html', url: 'https://www.gutenberg.org/ebooks/1342.html' },
        { format: 'epub', url: 'https://example.test/1342.epub' },
      ],
    });
    // A pre-existing failed intent must not be rewritten by the rejected POST.
    await db.insert(saveIntentTable).values({
      id: randomUUID(),
      userId: learner.userId,
      sourceRecordId: noCandidate.id,
      status: 'failed',
      failureCode: 'download_http_error',
      failureReason: 'upstream returned an error page',
    });

    const response = await app.request(`/api/library/source-records/${noCandidate.id}`, {
      method: 'POST',
      headers: { cookie: learner.cookie },
    });
    expect(response.status).toBe(HTTP_STATUS.CONFLICT);
    expect(((await response.json()) as { code: string }).code).toBe(
      ERROR_CODES.LIBRARY.SOURCE_RECORD_NO_EPUB_CANDIDATE,
    );

    await expect(saveSourceRecordToLibrary(learner.userId, noCandidate.id)).rejects.toMatchObject({
      statusCode: HTTP_STATUS.CONFLICT,
      code: ERROR_CODES.LIBRARY.SOURCE_RECORD_NO_EPUB_CANDIDATE,
    });

    // No intent was created, and the failed one keeps its recorded failure.
    const intents = await intentsFor(noCandidate.id);
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      status: 'failed',
      failureCode: 'download_http_error',
      failureReason: 'upstream returned an error page',
    });
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('saves on a later POST once the record gains a selectable EPUB candidate', async () => {
    const learner = track(await createSession());
    const record = await createRecord({ contentCandidates: [] });

    await expect(saveSourceRecordToLibrary(learner.userId, record.id)).rejects.toMatchObject({
      statusCode: HTTP_STATUS.CONFLICT,
    });
    expect(await intentsFor(record.id)).toHaveLength(0);
    expect(enqueueSpy).not.toHaveBeenCalled();

    // A metadata sync adds a selectable candidate; the failure was never cached.
    await db
      .update(sourceRecordTable)
      .set({
        contentCandidates: [{ format: 'epub', url: 'https://www.gutenberg.org/cache/epub/1/pg1.epub.images' }],
      })
      .where(eq(sourceRecordTable.id, record.id));

    expect(await saveSourceRecordToLibrary(learner.userId, record.id)).toEqual({
      status: 'pending',
      workId: null,
    });
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    const intents = await intentsFor(record.id);
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ userId: learner.userId, status: 'pending' });
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

  async function readSaveStatus(sourceRecordId: string, cookie?: string) {
    const response = await app.request(`/api/library/source-records/${sourceRecordId}`, {
      headers: cookie ? { cookie } : undefined,
    });
    return {
      status: response.status,
      body: (await response.json().catch(() => null)) as Record<string, unknown> | null,
    };
  }

  it('reads the save status API only for authenticated users of existing records', async () => {
    const record = await createRecord();

    expect((await readSaveStatus(record.id)).status).toBe(HTTP_STATUS.UNAUTHORIZED);

    const learner = track(await createSession());
    const known = await readSaveStatus(record.id, learner.cookie);
    expect(known.status).toBe(HTTP_STATUS.OK);
    expect(known.body).toEqual({ status: 'none', workId: null, failureReason: null });

    expect((await readSaveStatus(randomUUID(), learner.cookie)).status).toBe(HTTP_STATUS.NOT_FOUND);
  });

  it('reports pending while the linked Work is processing and completes to ready once it is readable', async () => {
    const learner = track(await createSession());
    const work = await createCatalogWorkFixture({
      title: 'Status Processing Work',
      processingStatus: 'processing',
      publishedAt: null,
    });
    createdWorkIds.push(work.id);
    const record = await createRecord({ workId: work.id, materializationStatus: 'processing' });

    await saveSourceRecordToLibrary(learner.userId, record.id);
    expect((await readSaveStatus(record.id, learner.cookie)).body).toEqual({
      status: 'pending',
      workId: work.id,
      failureReason: null,
    });

    // Refresh recovery: the Work becomes readable without an explicit fan-out
    // call, so the read must complete the intent and create membership.
    await markWorkReady(work.id);
    expect((await readSaveStatus(record.id, learner.cookie)).body).toEqual({
      status: 'ready',
      workId: work.id,
      failureReason: null,
    });
    expect(await membershipCount(learner.userId, work.id)).toBe(1);
    expect((await intentsFor(record.id))[0]?.status).toBe('completed');
  });

  it('reports a new Work failure, then keeps polling a retry until its worker advances the Work', async () => {
    const learner = track(await createSession());
    const work = await createCatalogWorkFixture({
      title: 'Status Failed Work',
      processingStatus: 'failed',
      publishedAt: null,
    });
    createdWorkIds.push(work.id);
    await db
      .update(readingWorkTable)
      .set({
        originMeta: { failedStep: 'parse', lastError: 'EPUB is missing META-INF/container.xml' },
        updatedAt: new Date(Date.now() - 30_000),
      })
      .where(eq(readingWorkTable.id, work.id));
    const record = await createRecord({ workId: work.id, materializationStatus: 'failed' });

    await saveSourceRecordToLibrary(learner.userId, record.id);
    // The failure belongs to this attempt, after its intent was created. The
    // backdates stay inside the recovery re-enqueue window so lazy recovery
    // leaves the work-failure propagation path under test intact.
    await db
      .update(saveIntentTable)
      .set({ updatedAt: new Date(Date.now() - 5 * 60_000) })
      .where(and(eq(saveIntentTable.userId, learner.userId), eq(saveIntentTable.sourceRecordId, record.id)));
    const failed = await readSaveStatus(record.id, learner.cookie);
    expect(failed.status).toBe(HTTP_STATUS.OK);
    expect(failed.body).toEqual({
      status: 'failed',
      workId: work.id,
      failureReason: 'EPUB is missing META-INF/container.xml',
    });
    expect((await intentsFor(record.id))[0]).toMatchObject({ status: 'failed', failureCode: 'processing_failed' });

    // A failed save stays retryable through the existing POST flow.
    const retry = await saveSourceRecordToLibrary(learner.userId, record.id);
    expect(retry.status).toBe('pending');
    expect((await intentsFor(record.id))[0]).toMatchObject({ status: 'pending', failureReason: null });
    // Work is still failed while the retry waits in the queue. A GET must not
    // interpret that previous attempt's failure as the retry's outcome.
    expect((await readSaveStatus(record.id, learner.cookie)).body).toEqual({
      status: 'pending',
      workId: work.id,
      failureReason: null,
    });
    expect((await intentsFor(record.id))[0]?.status).toBe('pending');
    await markWorkReady(work.id);
    expect((await readSaveStatus(record.id, learner.cookie)).body).toEqual({
      status: 'ready',
      workId: work.id,
      failureReason: null,
    });
    expect(await membershipCount(learner.userId, work.id)).toBe(1);
  });

  it('returns the recorded cleaned reason for an already failed intent', async () => {
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

    expect((await readSaveStatus(record.id, learner.cookie)).body).toEqual({
      status: 'failed',
      workId: null,
      failureReason: 'upstream returned an error page',
    });
  });

  it('keeps the save status isolated per user', async () => {
    const first = track(await createSession());
    const second = track(await createSession());
    const work = await createCatalogWorkFixture({
      title: 'Status Isolation Work',
      processingStatus: 'processing',
      publishedAt: null,
    });
    createdWorkIds.push(work.id);
    const record = await createRecord({ workId: work.id, materializationStatus: 'processing' });

    await saveSourceRecordToLibrary(first.userId, record.id);

    expect((await readSaveStatus(record.id, first.cookie)).body).toMatchObject({ status: 'pending' });
    expect((await readSaveStatus(record.id, second.cookie)).body).toEqual({
      status: 'none',
      workId: work.id,
      failureReason: null,
    });
    expect(await intentsFor(record.id)).toHaveLength(1);
  });

  it("drops only the removing user's Save Intent on removeFromLibrary so Discover re-offers saving", async () => {
    const learner = track(await createSession());
    const other = track(await createSession());
    const work = await createCatalogWorkFixture({ title: 'Removed From Library Work', publishedAt: null });
    createdWorkIds.push(work.id);
    const record = await createRecord({ workId: work.id, materializationStatus: 'ready' });

    // Both users save the shared SourceRecord into a ready membership.
    expect(await saveSourceRecordToLibrary(learner.userId, record.id)).toEqual({
      status: 'ready',
      workId: work.id,
    });
    expect(await saveSourceRecordToLibrary(other.userId, record.id)).toEqual({
      status: 'ready',
      workId: work.id,
    });

    // Reading progress must survive the removal.
    await db.insert(readingStateTable).values({
      id: randomUUID(),
      userId: learner.userId,
      workId: work.id,
      status: 'in_progress',
      anchorKind: 'part',
      anchorValue: 'fixture',
    });

    await removeFromLibrary(learner.userId, work.id);

    // The removing user's intent and membership are gone; the other user and
    // the reading state are untouched, and the Work itself still exists.
    const intents = await intentsFor(record.id);
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ userId: other.userId, status: 'completed' });
    expect(await membershipCount(learner.userId, work.id)).toBe(0);
    expect(await membershipCount(other.userId, work.id)).toBe(1);
    const states = await db
      .select({ id: readingStateTable.id })
      .from(readingStateTable)
      .where(and(eq(readingStateTable.userId, learner.userId), eq(readingStateTable.workId, work.id)));
    expect(states).toHaveLength(1);
    expect(
      await db.select({ id: readingWorkTable.id }).from(readingWorkTable).where(eq(readingWorkTable.id, work.id)),
    ).toHaveLength(1);

    // Discover reports `none` again instead of a stale `ready`.
    expect((await readSaveStatus(record.id, learner.cookie)).body).toEqual({
      status: 'none',
      workId: work.id,
      failureReason: null,
    });
    expect((await readSaveStatus(record.id, other.cookie)).body).toEqual({
      status: 'ready',
      workId: work.id,
      failureReason: null,
    });

    // Re-saving rebuilds the intent and completes immediately on the ready Work.
    expect(await saveSourceRecordToLibrary(learner.userId, record.id)).toEqual({
      status: 'ready',
      workId: work.id,
    });
    expect(await membershipCount(learner.userId, work.id)).toBe(1);
    const rebuilt = await intentsFor(record.id);
    expect(rebuilt.map((intent) => intent.userId).sort()).toEqual([other.userId, learner.userId].sort());
    expect(rebuilt.every((intent) => intent.status === 'completed')).toBe(true);
  });

  it("never touches another user's intent when removing a Personal Work with no SourceRecord", async () => {
    const owner = track(await createSession());
    const saver = track(await createSession());
    const personalWorkId = randomUUID();
    createdWorkIds.push(personalWorkId);
    await db.insert(readingWorkTable).values({
      id: personalWorkId,
      title: 'Personal Remove Guard',
      ownerUserId: owner.userId,
      visibility: 'private',
      originKind: 'user_epub',
      processingStatus: 'ready',
    });
    const work = await createCatalogWorkFixture({ title: 'Other User Saved Work', publishedAt: null });
    createdWorkIds.push(work.id);
    const record = await createRecord({ workId: work.id, materializationStatus: 'ready' });
    expect(await saveSourceRecordToLibrary(saver.userId, record.id)).toEqual({
      status: 'ready',
      workId: work.id,
    });

    await removeFromLibrary(owner.userId, personalWorkId);

    // The Personal Work links no SourceRecord, so its removal is a no-op for
    // Save Intents, memberships, and the Work row itself.
    const intents = await intentsFor(record.id);
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ userId: saver.userId, status: 'completed' });
    expect(await membershipCount(saver.userId, work.id)).toBe(1);
    expect(await membershipCount(owner.userId, work.id)).toBe(0);
    expect(
      await db
        .select({ id: readingWorkTable.id })
        .from(readingWorkTable)
        .where(eq(readingWorkTable.id, personalWorkId)),
    ).toHaveLength(1);
  });

  /** One shared session for the recovery suite keeps the auth rate limit intact. */
  let recoverySession: Awaited<ReturnType<typeof createSession>> | null = null;
  async function recoveryUser() {
    recoverySession ??= track(await createSession());
    return recoverySession;
  }

  it('fails the intent with enqueue_failed and rethrows when the enqueue rejects', async () => {
    const learner = await recoveryUser();
    const record = await createRecord();
    enqueueSpy.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:6380'));

    await expect(saveSourceRecordToLibrary(learner.userId, record.id)).rejects.toThrow('ECONNREFUSED');

    const intents = await intentsFor(record.id);
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ status: 'failed', failureCode: 'enqueue_failed' });
    expect(intents[0]?.failureReason).toBe('connect ECONNREFUSED 127.0.0.1:6380');
  });

  it('re-enqueues a stale pending intent without a Work on the lazy status read', async () => {
    const learner = await recoveryUser();
    const record = await createRecord();
    const staleAt = await insertStalePendingIntent(learner.userId, record.id, SAVE_INTENT_REENQUEUE_AFTER_MS + 60_000);
    expect(enqueueSpy).not.toHaveBeenCalled();

    const read = await readSaveStatus(record.id, learner.cookie);
    expect(read.status).toBe(HTTP_STATUS.OK);
    expect(read.body).toEqual({ status: 'pending', workId: null, failureReason: null });

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy.mock.calls[0]![1]).toEqual({ sourceRecordId: record.id });
    expect((enqueueSpy.mock.calls[0]![2] as { jobId: string }).jobId).toBe(`source-record-materialize-${record.id}`);
    const [intent] = await intentsFor(record.id);
    expect(intent?.status).toBe('pending');
    // The recovery refresh keeps the next re-enqueue a full window away.
    expect(intent!.updatedAt.getTime()).toBeGreaterThan(staleAt.getTime());
  });

  it('times out a stale pending intent past the deadline instead of polling forever', async () => {
    const learner = await recoveryUser();
    const record = await createRecord();
    await insertStalePendingIntent(learner.userId, record.id, SAVE_INTENT_TIMEOUT_AFTER_MS + 60_000);

    const read = await readSaveStatus(record.id, learner.cookie);

    expect(read.body).toEqual({
      status: 'failed',
      workId: null,
      failureReason: 'Content import did not finish in time. Please retry.',
    });
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect((await intentsFor(record.id))[0]).toMatchObject({
      status: 'failed',
      failureCode: 'processing_timeout',
    });
  });

  it('completes a stale pending intent whose linked Work is already readable', async () => {
    const learner = await recoveryUser();
    const work = await createCatalogWorkFixture({ title: 'Stale Intent Ready Work', publishedAt: null });
    createdWorkIds.push(work.id);
    const record = await createRecord({ workId: work.id, materializationStatus: 'ready' });
    await insertStalePendingIntent(learner.userId, record.id, SAVE_INTENT_REENQUEUE_AFTER_MS + 60_000);

    const read = await readSaveStatus(record.id, learner.cookie);

    expect(read.body).toEqual({ status: 'ready', workId: work.id, failureReason: null });
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(await membershipCount(learner.userId, work.id)).toBe(1);
    expect((await intentsFor(record.id))[0]?.status).toBe('completed');
  });

  it('recovers stale intents in one bounded periodic pass and leaves fresh ones alone', async () => {
    const learner = await recoveryUser();
    const requeuedRecord = await createRecord();
    const timedOutRecord = await createRecord();
    const freshRecord = await createRecord();
    await insertStalePendingIntent(learner.userId, requeuedRecord.id, SAVE_INTENT_REENQUEUE_AFTER_MS + 60_000);
    await insertStalePendingIntent(learner.userId, timedOutRecord.id, SAVE_INTENT_TIMEOUT_AFTER_MS + 60_000);
    await insertStalePendingIntent(learner.userId, freshRecord.id, 60_000);

    await recoverStaleSaveIntents();

    const enqueuedFor = (sourceRecordId: string) =>
      enqueueSpy.mock.calls.filter((call) => (call[1] as { sourceRecordId: string }).sourceRecordId === sourceRecordId);
    expect(enqueuedFor(requeuedRecord.id)).toHaveLength(1);
    expect((enqueuedFor(requeuedRecord.id)[0]![2] as { jobId: string }).jobId).toBe(
      `source-record-materialize-${requeuedRecord.id}`,
    );
    expect((await intentsFor(requeuedRecord.id))[0]?.status).toBe('pending');
    expect(enqueuedFor(timedOutRecord.id)).toHaveLength(0);
    expect((await intentsFor(timedOutRecord.id))[0]).toMatchObject({
      status: 'failed',
      failureCode: 'processing_timeout',
    });
    // A fresh pending intent is untouched by the pass.
    expect(enqueuedFor(freshRecord.id)).toHaveLength(0);
    expect((await intentsFor(freshRecord.id))[0]?.status).toBe('pending');
  });

  it('fails a stale pending intent on first recovery when the record lost its EPUB candidate', async () => {
    const learner = await recoveryUser();
    const lazyRecord = await createRecord({ contentCandidates: [] });
    const periodicRecord = await createRecord({ contentCandidates: [] });
    await insertStalePendingIntent(learner.userId, lazyRecord.id, SAVE_INTENT_REENQUEUE_AFTER_MS + 60_000);
    await insertStalePendingIntent(learner.userId, periodicRecord.id, SAVE_INTENT_REENQUEUE_AFTER_MS + 60_000);
    const enqueuedFor = (sourceRecordId: string) =>
      enqueueSpy.mock.calls.filter((call) => (call[1] as { sourceRecordId: string }).sourceRecordId === sourceRecordId);

    // Lazy recovery on the status read: no candidate means nothing could ever
    // succeed, so the intent fails immediately instead of re-enqueueing until timeout.
    const read = await readSaveStatus(lazyRecord.id, learner.cookie);
    expect(read.body).toEqual({
      status: 'failed',
      workId: null,
      failureReason: 'No downloadable EPUB is available for this item.',
    });
    expect((await intentsFor(lazyRecord.id))[0]).toMatchObject({
      status: 'failed',
      failureCode: 'no_epub_candidate',
    });
    expect(enqueuedFor(lazyRecord.id)).toHaveLength(0);

    // The periodic pass resolves the same state identically.
    await recoverStaleSaveIntents();
    expect((await intentsFor(periodicRecord.id))[0]).toMatchObject({
      status: 'failed',
      failureCode: 'no_epub_candidate',
    });
    expect(enqueuedFor(periodicRecord.id)).toHaveLength(0);

    // A linked record keeps re-enqueueing without candidates: materialization
    // resolves its existing Work without one (same rule as the save gate).
    const linkedWork = await createCatalogWorkFixture({
      title: 'Stale Linked No Candidate',
      processingStatus: 'processing',
      publishedAt: null,
    });
    createdWorkIds.push(linkedWork.id);
    const linkedRecord = await createRecord({
      workId: linkedWork.id,
      materializationStatus: 'processing',
      contentCandidates: [],
    });
    await insertStalePendingIntent(learner.userId, linkedRecord.id, SAVE_INTENT_REENQUEUE_AFTER_MS + 60_000);

    await recoverStaleSaveIntents();
    expect(enqueuedFor(linkedRecord.id)).toHaveLength(1);
    expect((await intentsFor(linkedRecord.id))[0]?.status).toBe('pending');
  });

  it('accepts a re-save of an already-linked Work whose candidates were cleared after sync', async () => {
    const learner = track(await createSession());
    const readyWork = await createCatalogWorkFixture({ title: 'Linked Cleared Candidates', publishedAt: null });
    createdWorkIds.push(readyWork.id);
    const readyRecord = await createRecord({
      workId: readyWork.id,
      materializationStatus: 'ready',
      contentCandidates: [],
    });

    // The Work is already linked and readable: the candidate gate must not turn
    // a saved item into a 409 when a sync clears its candidates afterwards.
    const response = await app.request(`/api/library/source-records/${readyRecord.id}`, {
      method: 'POST',
      headers: { cookie: learner.cookie },
    });
    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(((await response.json()) as { status: string }).status).toBe('ready');
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(await membershipCount(learner.userId, readyWork.id)).toBe(1);
    expect((await intentsFor(readyRecord.id))[0]?.status).toBe('completed');

    // A linked Work that is still importing keeps the materialize reuse/retry
    // semantics: pending + enqueue instead of a conflict.
    const processingWork = await createCatalogWorkFixture({
      title: 'Linked Processing Cleared Candidates',
      processingStatus: 'processing',
      publishedAt: null,
    });
    createdWorkIds.push(processingWork.id);
    const processingRecord = await createRecord({
      workId: processingWork.id,
      materializationStatus: 'processing',
      contentCandidates: [],
    });
    const pending = await app.request(`/api/library/source-records/${processingRecord.id}`, {
      method: 'POST',
      headers: { cookie: learner.cookie },
    });
    expect(pending.status).toBe(HTTP_STATUS.OK);
    expect(((await pending.json()) as { status: string }).status).toBe('pending');
    expect(enqueueSpy).toHaveBeenCalledTimes(1);

    // An unlinked record with no candidate keeps the 409 gate.
    const unlinked = await createRecord({ contentCandidates: [] });
    const conflict = await app.request(`/api/library/source-records/${unlinked.id}`, {
      method: 'POST',
      headers: { cookie: learner.cookie },
    });
    expect(conflict.status).toBe(HTTP_STATUS.CONFLICT);
    expect(((await conflict.json()) as { code: string }).code).toBe(
      ERROR_CODES.LIBRARY.SOURCE_RECORD_NO_EPUB_CANDIDATE,
    );
    expect(await intentsFor(unlinked.id)).toHaveLength(0);
  });
});
