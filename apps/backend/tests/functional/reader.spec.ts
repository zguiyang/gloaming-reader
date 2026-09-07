import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import {
  readingPart as readingPartTable,
  readingState as readingStateTable,
  readingWork as readingWorkTable,
  user as userTable,
} from '@gloaming/db';
import { type ReaderPartsData, type ReadingState } from '@gloaming/shared';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';

import app from '@/app';
import { db } from '@/db';

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

describe('Reader HTTP', () => {
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

  it('supports parts list, chapter progress, and finish/restart', async () => {
    const admin = await createSession('admin');
    const learner = await createSession('user');
    createdEmails.push(admin.email, learner.email);

    const create = await app.request('/api/admin/works', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({
        title: 'Ocean Quiet',
        body: 'The sea is wide.\n\nLife hides below.',
      }),
    });
    expect(create.status).toBe(201);
    const work = (await create.json()) as { id: string };
    createdWorkIds.push(work.id);

    await db.insert(readingPartTable).values({
      id: randomUUID(),
      workId: work.id,
      sortOrder: 1,
      kind: 'chapter',
      title: 'The Second Chapter',
      body: 'The second chapter begins.',
    });
    await db.insert(readingPartTable).values({
      id: randomUUID(),
      workId: work.id,
      sortOrder: 2,
      kind: 'chapter',
      title: 'The Third Chapter',
      body: 'The third chapter begins.',
    });

    await app.request(`/api/admin/works/${work.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({ sources: ['demo'], tags: ['science'] }),
    });

    const publish = await app.request(`/api/admin/works/${work.id}/publish`, {
      method: 'POST',
      headers: { cookie: admin.cookie },
    });
    expect(publish.status).toBe(200);

    const partsRes = await app.request(`/api/reader/works/${work.id}/parts`);
    expect(partsRes.status).toBe(200);
    const partsData = (await partsRes.json()) as ReaderPartsData;
    expect(partsData.parts).toHaveLength(3);

    const partId = partsData.parts[0]!.id;
    const secondPartId = partsData.parts[1]!.id;
    const thirdPartId = partsData.parts[2]!.id;
    const partRes = await app.request(`/api/reader/parts/${partId}`);
    expect(partRes.status).toBe(200);

    const [open, addToShelf] = await Promise.all([
      app.request(`/api/reader/works/${work.id}/state`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: learner.cookie },
        body: JSON.stringify({ action: 'open' }),
      }),
      app.request(`/api/reader/works/${work.id}/state`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: learner.cookie },
        body: JSON.stringify({ action: 'add_to_shelf' }),
      }),
    ]);
    expect(open.status).toBe(200);
    expect(addToShelf.status).toBe(200);
    const opened = (await open.json()) as ReadingState;
    const [learnerRow] = await db
      .select({ id: userTable.id })
      .from(userTable)
      .where(eq(userTable.email, learner.email))
      .limit(1);
    const stateRows = await db.select().from(readingStateTable).where(eq(readingStateTable.userId, learnerRow!.id));
    expect(stateRows.filter((row) => row.workId === work.id)).toHaveLength(1);
    expect(opened.revision).toEqual(expect.any(Number));
    expect(opened.status).toBe('in_progress');
    expect(opened.progressRatio).toBe(0);

    const navigatedForward = await app.request(`/api/reader/works/${work.id}/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: learner.cookie },
      body: JSON.stringify({ action: 'navigate', partId: secondPartId, expectedRevision: opened.revision }),
    });
    expect(navigatedForward.status).toBe(200);
    const navigatedForwardState = (await navigatedForward.json()) as ReadingState;
    expect(navigatedForwardState.currentPartId).toBe(secondPartId);
    expect(navigatedForwardState.completedThroughSortOrder).toBe(-1);
    expect(navigatedForwardState.progressRatio).toBe(0);

    const reopenedAtFirstPart = await app.request(`/api/reader/works/${work.id}/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: learner.cookie },
      body: JSON.stringify({
        action: 'open',
        partId,
        expectedRevision: navigatedForwardState.revision,
      }),
    });
    expect(reopenedAtFirstPart.status).toBe(200);
    const reopenedState = (await reopenedAtFirstPart.json()) as ReadingState;
    expect(reopenedState.currentPartId).toBe(partId);
    expect(reopenedState.progressRatio).toBe(0);

    const currentOpen = await app.request(`/api/reader/works/${work.id}/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: learner.cookie },
      body: JSON.stringify({ action: 'open' }),
    });
    expect(currentOpen.status).toBe(200);
    expect((currentOpen.headers.get('content-type') ?? '').toLowerCase()).toContain('application/json');

    const staleOpen = await app.request(`/api/reader/works/${work.id}/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: learner.cookie },
      body: JSON.stringify({ action: 'open', expectedRevision: opened.revision }),
    });
    expect(staleOpen.status).toBe(409);

    const finish = await app.request(`/api/reader/works/${work.id}/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: learner.cookie },
      body: JSON.stringify({ action: 'finish' }),
    });
    expect(finish.status).toBe(200);
    const finished = (await finish.json()) as ReadingState;
    expect(finished.progressRatio).toBe(100);
    expect(finished.status).toBe('completed');
    expect(finished.completedAt).toEqual(expect.any(String));

    const navigateAfterFinish = await app.request(`/api/reader/works/${work.id}/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: learner.cookie },
      body: JSON.stringify({ action: 'navigate', partId: secondPartId, expectedRevision: finished.revision }),
    });
    expect(navigateAfterFinish.status).toBe(200);
    const navigated = (await navigateAfterFinish.json()) as ReadingState;
    expect(navigated.currentPartId).toBe(secondPartId);
    expect(navigated.status).toBe('completed');
    expect(navigated.completedAt).toBe(finished.completedAt);

    const openAfterFinish = await app.request(`/api/reader/works/${work.id}/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: learner.cookie },
      body: JSON.stringify({ action: 'open', partId, expectedRevision: navigated.revision }),
    });
    expect(openAfterFinish.status).toBe(200);
    const openedAfterFinish = (await openAfterFinish.json()) as ReadingState;
    expect(openedAfterFinish.currentPartId).toBe(partId);
    expect(openedAfterFinish.status).toBe('completed');
    expect(openedAfterFinish.completedAt).toBe(finished.completedAt);

    const navigateToSecondAfterFinish = await app.request(`/api/reader/works/${work.id}/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: learner.cookie },
      body: JSON.stringify({ action: 'navigate', partId: secondPartId, expectedRevision: openedAfterFinish.revision }),
    });
    expect(navigateToSecondAfterFinish.status).toBe(200);
    const navigatedToSecondAfterFinish = (await navigateToSecondAfterFinish.json()) as ReadingState;

    const completeAfterFinish = await app.request(`/api/reader/works/${work.id}/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: learner.cookie },
      body: JSON.stringify({ action: 'complete_chapter', expectedRevision: navigatedToSecondAfterFinish.revision }),
    });
    expect(completeAfterFinish.status).toBe(200);
    const completedAfterFinish = (await completeAfterFinish.json()) as ReadingState;
    expect(completedAfterFinish.currentPartId).toBe(thirdPartId);
    expect(completedAfterFinish.status).toBe('completed');
    expect(completedAfterFinish.completedAt).toBe(finished.completedAt);
    expect(completedAfterFinish.completedThroughSortOrder).toBe(finished.completedThroughSortOrder);
    expect(completedAfterFinish.progressRatio).toBe(100);

    const staleAfterFinish = await app.request(`/api/reader/works/${work.id}/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: learner.cookie },
      body: JSON.stringify({ action: 'open', expectedRevision: finished.revision }),
    });
    expect(staleAfterFinish.status).toBe(409);

    const finishAgain = await app.request(`/api/reader/works/${work.id}/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: learner.cookie },
      body: JSON.stringify({ action: 'finish', expectedRevision: completedAfterFinish.revision }),
    });
    expect(finishAgain.status).toBe(200);
    const finishedAgain = (await finishAgain.json()) as ReadingState;
    expect(finishedAgain.currentPartId).toBe(thirdPartId);
    expect(finishedAgain.completedAt).toBe(finished.completedAt);

    const restart = await app.request(`/api/reader/works/${work.id}/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: learner.cookie },
      body: JSON.stringify({ action: 'restart', expectedRevision: finishedAgain.revision }),
    });
    expect(restart.status).toBe(200);
    const restarted = (await restart.json()) as ReadingState;
    expect(restarted.progressRatio).toBe(0);
    expect(restarted.currentPartId).toBe(partId);
    expect(restarted.completedThroughSortOrder).toBe(-1);
    expect(restarted.completedAt).toBeNull();
  });
});
