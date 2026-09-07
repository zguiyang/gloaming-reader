import { randomUUID } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import {
  readingDay as readingDayTable,
  readingState as readingStateTable,
  readingWork as readingWorkTable,
  user as userTable,
} from '@gloaming/db';
import type { AdminWork } from '@gloaming/shared';
import {
  calendarDateInTimeZone,
  READING_DAY_ENGAGED_SECONDS_CAP,
  READING_HEARTBEAT_MAX_CREDIT_SECONDS,
  type ReadingHistoryData,
} from '@gloaming/shared';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';

import app from '@/app';
import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import * as conversationsService from '@/modules/conversations/service';
import { recordReadingHeartbeat } from '@/modules/reading-history/service';

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
  const cookie = cookieHeader(login);
  const me = await app.request('/api/me', { headers: { cookie } });
  expect(me.status).toBe(200);
  const user = (await me.json()) as { id: string };
  return { email, cookie, userId: user.id };
}

async function createPublishedWork(adminCookie: string, title: string): Promise<AdminWork> {
  const create = await app.request('/api/admin/works', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({
      title,
      body: 'The ocean is full of mysteries.\n\nA warm current carries nutrients.',
    }),
  });
  expect(create.status).toBe(201);
  const work = (await create.json()) as AdminWork;

  expect(
    (
      await app.request(`/api/admin/works/${work.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ sources: ['demo'], tags: ['science'] }),
      })
    ).status,
  ).toBe(200);

  const publish = await app.request(`/api/admin/works/${work.id}/publish`, {
    method: 'POST',
    headers: { cookie: adminCookie },
  });
  expect(publish.status).toBe(200);
  return work;
}

async function getReadingHistory(cookie: string): Promise<ReadingHistoryData> {
  const response = await app.request('/api/reading-history', { headers: { cookie } });
  expect(response.status).toBe(200);
  return (await response.json()) as ReadingHistoryData;
}

async function listReadingDays(userId: string) {
  return db
    .select({ localDate: readingDayTable.localDate, engagedSeconds: readingDayTable.engagedSeconds })
    .from(readingDayTable)
    .where(eq(readingDayTable.userId, userId));
}

describe('Reading history HTTP', () => {
  const createdEmails: string[] = [];
  const createdWorkIds: string[] = [];

  afterAll(async () => {
    if (createdWorkIds.length > 0) {
      await db.delete(readingWorkTable).where(inArray(readingWorkTable.id, createdWorkIds));
    }
    for (const email of createdEmails) {
      await db.delete(userTable).where(eq(userTable.email, email));
    }
  });

  it('requires a session and does not treat shelf as a reading-activity day', async () => {
    const anonymous = await app.request('/api/reading-history');
    expect(anonymous.status).toBe(HTTP_STATUS.UNAUTHORIZED);

    const learner = await createSession('user');
    createdEmails.push(learner.email);

    expect((await app.request('/api/shelf', { headers: { cookie: learner.cookie } })).status).toBe(200);

    const empty = await getReadingHistory(learner.cookie);
    expect(empty.today).toBe(calendarDateInTimeZone());
    expect(empty.activity).toEqual([]);
    expect(empty.works).toEqual([]);
    expect(empty.portrait).toEqual({
      consecutiveDays: 0,
      readingDays: 0,
      completedWorks: 0,
      lookedUpWords: 0,
    });
  });

  it('keeps GET read-only and supports bounded, authorized, idempotent backfill', async () => {
    const admin = await createSession('admin');
    const learner = await createSession('user');
    createdEmails.push(admin.email, learner.email);
    const work = await createPublishedWork(admin.cookie, 'History Sea');
    createdWorkIds.push(work.id);
    const partId = work.parts[0]!.id;

    const createdAt = new Date('2026-01-10T04:00:00.000Z');
    const lastReadAt = new Date('2026-01-15T04:00:00.000Z');
    await db.insert(readingStateTable).values({
      id: randomUUID(),
      userId: learner.userId,
      workId: work.id,
      currentPartId: partId,
      anchorKind: 'percent',
      anchorValue: '20',
      status: 'in_progress',
      createdAt,
      lastReadAt,
      completedAt: null,
    });

    expect(await listReadingDays(learner.userId)).toEqual([]);
    const readOnly = await getReadingHistory(learner.cookie);
    expect(await listReadingDays(learner.userId)).toEqual([]);
    expect(readOnly.activity).toEqual([]);

    const anonymousBackfill = await app.request('/api/admin/reading-history/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: learner.userId }),
    });
    expect(anonymousBackfill.status).toBe(HTTP_STATUS.UNAUTHORIZED);

    const forbiddenBackfill = await app.request('/api/admin/reading-history/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: learner.cookie },
      body: JSON.stringify({ userId: learner.userId }),
    });
    expect(forbiddenBackfill.status).toBe(HTTP_STATUS.FORBIDDEN);

    const unboundedBackfill = await app.request('/api/admin/reading-history/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({ userId: learner.userId, dates: ['1900-01-01'] }),
    });
    expect(unboundedBackfill.status).toBe(HTTP_STATUS.BAD_REQUEST);

    const firstBackfill = await app.request('/api/admin/reading-history/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({ userId: learner.userId }),
    });
    expect(firstBackfill.status).toBe(200);
    expect(await firstBackfill.json()).toEqual({
      userId: learner.userId,
      candidateDays: 2,
      insertedDays: 2,
    });
    expect((await listReadingDays(learner.userId)).map((row) => row.localDate).sort()).toEqual([
      '2026-01-10',
      '2026-01-15',
    ]);

    const retryBackfill = await app.request('/api/admin/reading-history/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({ userId: learner.userId }),
    });
    expect(retryBackfill.status).toBe(200);
    expect(await retryBackfill.json()).toEqual({
      userId: learner.userId,
      candidateDays: 2,
      insertedDays: 0,
    });

    const backfilled = await getReadingHistory(learner.cookie);
    // Presence-only backfill days have no engaged seconds — heatmap stays empty.
    expect(backfilled.activity).toEqual([]);
    expect(backfilled.works).toEqual([
      expect.objectContaining({
        workId: work.id,
        title: 'History Sea',
        status: 'in_progress',
        date: calendarDateInTimeZone(lastReadAt),
        author: expect.any(String),
        coverAssetId: null,
      }),
    ]);

    expect(
      (
        await app.request(`/api/reader/works/${work.id}/state`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', cookie: learner.cookie },
          body: JSON.stringify({ action: 'open' }),
        })
      ).status,
    ).toBe(200);
    const complete = await app.request(`/api/reader/works/${work.id}/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: learner.cookie },
      body: JSON.stringify({ action: 'finish' }),
    });
    expect(complete.status).toBe(200);

    const today = calendarDateInTimeZone();
    const live = await getReadingHistory(learner.cookie);
    expect(live.activity).toEqual([]);
    expect(live.portrait.completedWorks).toBe(1);
    expect(live.portrait.readingDays).toBe(0);
    expect(live.works[0]).toMatchObject({
      title: 'History Sea',
      workId: work.id,
      status: 'completed',
      date: today,
      author: expect.any(String),
      coverAssetId: null,
    });
  });

  it('counts distinct lookup selections', async () => {
    const admin = await createSession('admin');
    const learner = await createSession('user');
    createdEmails.push(admin.email, learner.email);
    const work = await createPublishedWork(admin.cookie, 'History Lookups');
    createdWorkIds.push(work.id);

    expect(
      (
        await app.request(`/api/reader/works/${work.id}/state`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', cookie: learner.cookie },
          body: JSON.stringify({ action: 'open' }),
        })
      ).status,
    ).toBe(200);

    await conversationsService.appendAssistTurn({
      userId: learner.userId,
      surface: 'assist-read',
      subjectType: 'reading_work',
      subjectId: work.id,
      userContent: 'Ocean',
      assistantContent: '海。',
      assistantStatus: 'complete',
      userMetadata: { actionId: 'lookup', selection: 'Ocean' },
    });
    await conversationsService.appendAssistTurn({
      userId: learner.userId,
      surface: 'assist-read',
      subjectType: 'reading_work',
      subjectId: work.id,
      userContent: 'ocean',
      assistantContent: '海。',
      assistantStatus: 'complete',
      userMetadata: { actionId: 'lookup', selection: ' ocean ' },
    });
    await conversationsService.appendAssistTurn({
      userId: learner.userId,
      surface: 'assist-read',
      subjectType: 'reading_work',
      subjectId: work.id,
      userContent: 'current',
      assistantContent: '洋流。',
      assistantStatus: 'complete',
      userMetadata: { actionId: 'lookup', selection: 'current' },
    });
    await conversationsService.appendAssistTurn({
      userId: learner.userId,
      surface: 'assist-read',
      subjectType: 'reading_work',
      subjectId: work.id,
      userContent: 'Why?',
      assistantContent: 'Because…',
      assistantStatus: 'complete',
      userMetadata: { actionId: 'meaning', selection: 'mysteries' },
    });

    const snapshot = await getReadingHistory(learner.cookie);
    expect(snapshot.portrait.lookedUpWords).toBe(2);
  });

  it('accumulates engaged seconds from reading heartbeats', async () => {
    const learner = await createSession('user');
    createdEmails.push(learner.email);

    const unauthorized = await app.request('/api/reading-heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds: 30 }),
    });
    expect(unauthorized.status).toBe(HTTP_STATUS.UNAUTHORIZED);

    const overLimit = await app.request('/api/reading-heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: learner.cookie },
      body: JSON.stringify({ seconds: READING_HEARTBEAT_MAX_CREDIT_SECONDS + 1 }),
    });
    expect(overLimit.status).toBe(HTTP_STATUS.BAD_REQUEST);

    const first = await app.request('/api/reading-heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: learner.cookie },
      body: JSON.stringify({ seconds: 30 }),
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      localDate: calendarDateInTimeZone(),
      engagedSeconds: 30,
    });

    const second = await app.request('/api/reading-heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: learner.cookie },
      body: JSON.stringify({ seconds: 15 }),
    });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({
      localDate: calendarDateInTimeZone(),
      engagedSeconds: 45,
    });

    const history = await getReadingHistory(learner.cookie);
    expect(history.activity).toEqual([{ date: calendarDateInTimeZone(), engagedSeconds: 45 }]);
    expect(history.portrait.readingDays).toBe(1);
    expect(history.portrait.consecutiveDays).toBe(1);

    await db
      .update(readingDayTable)
      .set({ engagedSeconds: READING_DAY_ENGAGED_SECONDS_CAP - 1 })
      .where(and(eq(readingDayTable.userId, learner.userId), eq(readingDayTable.localDate, calendarDateInTimeZone())));
    expect((await recordReadingHeartbeat(learner.userId, READING_HEARTBEAT_MAX_CREDIT_SECONDS)).engagedSeconds).toBe(
      READING_DAY_ENGAGED_SECONDS_CAP,
    );
    expect((await recordReadingHeartbeat(learner.userId, READING_HEARTBEAT_MAX_CREDIT_SECONDS)).engagedSeconds).toBe(
      READING_DAY_ENGAGED_SECONDS_CAP,
    );
  });
});
