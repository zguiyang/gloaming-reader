import { randomUUID } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  readingDay as readingDayTable,
  readingPart as readingPartTable,
  readingState as readingStateTable,
  readingWork as readingWorkTable,
  user as userTable,
  userLibraryItem as userLibraryItemTable,
} from '@gloaming/db';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';
import type { LibraryData } from '@gloaming/shared/library';
import type { AdminWork } from '@gloaming/shared/works';

import app from '@/app';
import { db } from '@/infra/db';

import { seedReadyDefaultAudioForWork } from '../../../helpers/publish-audio-fixture';
import { ensureWorkTaxonomyFixture } from '../../../helpers/taxonomy-fixture';

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
  if (role === 'admin') await db.update(userTable).set({ role: AUTH_ADMIN_ROLE }).where(eq(userTable.email, email));
  const login = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password }),
  });
  expect(login.status).toBe(200);
  const [user] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, email)).limit(1);
  return { email, cookie: cookieHeader(login), userId: user!.id };
}

describe('Library HTTP', () => {
  const createdEmails: string[] = [];
  const createdWorkIds: string[] = [];

  afterAll(async () => {
    if (createdWorkIds.length) await db.delete(readingWorkTable).where(inArray(readingWorkTable.id, createdWorkIds));
    for (const email of createdEmails) await db.delete(userTable).where(eq(userTable.email, email));
  });

  it('keeps reading progress separate from Catalog membership until explicitly saved', async () => {
    const admin = await createSession('admin');
    const learner = await createSession('user');
    createdEmails.push(admin.email, learner.email);

    const create = await app.request('/api/admin/catalog/works', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({ title: 'Library Ocean', body: 'The sea is wide.' }),
    });
    expect(create.status).toBe(201);
    const work = (await create.json()) as AdminWork;
    createdWorkIds.push(work.id);
    const taxonomyUpdate = await app.request(`/api/admin/catalog/works/${work.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify(await ensureWorkTaxonomyFixture('library')),
    });
    expect(taxonomyUpdate.status).toBe(200);
    await seedReadyDefaultAudioForWork(work.id);
    expect(
      (
        await app.request(`/api/admin/catalog/works/${work.id}/publish`, {
          method: 'POST',
          headers: { cookie: admin.cookie },
        })
      ).status,
    ).toBe(200);

    const opened = await app.request(`/api/reader/works/${work.id}/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: learner.cookie },
      body: JSON.stringify({ action: 'open' }),
    });
    expect(opened.status).toBe(200);

    const reading = await db
      .select({ state: readingStateTable.id, day: readingDayTable.localDate })
      .from(readingStateTable)
      .innerJoin(readingDayTable, eq(readingDayTable.userId, readingStateTable.userId))
      .where(and(eq(readingStateTable.userId, learner.userId), eq(readingStateTable.workId, work.id)));
    expect(reading).toHaveLength(1);

    const unsaved = await app.request('/api/library', { headers: { cookie: learner.cookie } });
    expect(unsaved.status).toBe(200);
    const unsavedData = (await unsaved.json()) as LibraryData;
    expect(unsavedData.current?.work.id).toBe(work.id);
    expect(unsavedData.items).toEqual([]);
    const progressBeforeMembership = await db
      .select()
      .from(readingStateTable)
      .where(and(eq(readingStateTable.userId, learner.userId), eq(readingStateTable.workId, work.id)));

    expect(
      (
        await app.request(`/api/library/${work.id}`, {
          method: 'POST',
          headers: { cookie: learner.cookie },
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await app.request(`/api/library/${work.id}`, {
          method: 'POST',
          headers: { cookie: learner.cookie },
        })
      ).status,
    ).toBe(204);
    const saved = await app.request('/api/library', { headers: { cookie: learner.cookie } });
    const savedData = (await saved.json()) as LibraryData;
    expect(savedData.items.map((item) => item.work.id)).toContain(work.id);
    expect(savedData.items.find((item) => item.work.id === work.id)?.state?.status).toBe('in_progress');
    expect(
      await db
        .select()
        .from(userLibraryItemTable)
        .where(and(eq(userLibraryItemTable.userId, learner.userId), eq(userLibraryItemTable.workId, work.id))),
    ).toHaveLength(1);

    expect(
      (
        await app.request(`/api/library/${work.id}`, {
          method: 'DELETE',
          headers: { cookie: learner.cookie },
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await app.request(`/api/library/${work.id}`, {
          method: 'DELETE',
          headers: { cookie: learner.cookie },
        })
      ).status,
    ).toBe(204);
    const removed = await app.request('/api/library', { headers: { cookie: learner.cookie } });
    const removedData = (await removed.json()) as LibraryData;
    expect(removedData.items).toEqual([]);
    expect(removedData.current?.work.id).toBe(work.id);
    const progressAfterRemoval = await db
      .select()
      .from(readingStateTable)
      .where(and(eq(readingStateTable.userId, learner.userId), eq(readingStateTable.workId, work.id)));
    expect(progressAfterRemoval).toEqual(progressBeforeMembership);
    expect(await db.select().from(readingDayTable).where(eq(readingDayTable.userId, learner.userId))).toHaveLength(1);

    expect(
      (
        await app.request(`/api/library/${work.id}`, {
          method: 'POST',
          headers: { cookie: learner.cookie },
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await app.request(`/api/admin/catalog/works/${work.id}/unpublish`, {
          method: 'POST',
          headers: { cookie: admin.cookie },
        })
      ).status,
    ).toBe(200);
    const hiddenAfterUnpublish = await app.request('/api/library', { headers: { cookie: learner.cookie } });
    expect(((await hiddenAfterUnpublish.json()) as LibraryData).items).toEqual([]);
    expect(
      (
        await app.request(`/api/library/${work.id}`, {
          method: 'POST',
          headers: { cookie: learner.cookie },
        })
      ).status,
    ).toBe(404);
    expect(
      await db
        .select()
        .from(readingStateTable)
        .where(and(eq(readingStateTable.userId, learner.userId), eq(readingStateTable.workId, work.id))),
    ).toEqual(progressBeforeMembership);
  });

  it('includes Personal ownership and never creates a saved Catalog row for Personal Works', async () => {
    const owner = await createSession();
    const other = await createSession();
    createdEmails.push(owner.email, other.email);
    const workId = randomUUID();
    createdWorkIds.push(workId);
    await db.insert(readingWorkTable).values({
      id: workId,
      title: 'Private Personal Work',
      ownerUserId: owner.userId,
      visibility: 'private',
      originKind: 'user_epub',
      processingStatus: 'ready',
    });
    await db
      .insert(readingPartTable)
      .values({ id: randomUUID(), workId, sortOrder: 0, title: 'Opening', body: 'Text' });

    const ownerLibrary = await app.request('/api/library', { headers: { cookie: owner.cookie } });
    const ownerData = (await ownerLibrary.json()) as LibraryData;
    expect(ownerData.items.map((item) => item.work.id)).toContain(workId);
    expect(ownerData.items.find((item) => item.work.id === workId)?.state).toBeNull();
    expect(
      (await app.request(`/api/library/${workId}`, { method: 'POST', headers: { cookie: owner.cookie } })).status,
    ).toBe(404);
    expect(
      (await app.request(`/api/library/${workId}`, { method: 'POST', headers: { cookie: other.cookie } })).status,
    ).toBe(404);
    expect(await db.select().from(userLibraryItemTable).where(eq(userLibraryItemTable.workId, workId))).toHaveLength(0);
    const otherLibrary = await app.request('/api/library', { headers: { cookie: other.cookie } });
    expect(((await otherLibrary.json()) as LibraryData).items.map((item) => item.work.id)).not.toContain(workId);
  });

  it('requires authentication and rejects unpublished Catalog Works', async () => {
    const admin = await createSession('admin');
    const learner = await createSession();
    createdEmails.push(admin.email, learner.email);
    const create = await app.request('/api/admin/catalog/works', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({ title: 'Unpublished Library Work', body: 'Not published.' }),
    });
    expect(create.status).toBe(201);
    const work = (await create.json()) as AdminWork;
    createdWorkIds.push(work.id);
    expect((await app.request('/api/library')).status).toBe(401);
    expect((await app.request('/api/shelf', { headers: { cookie: learner.cookie } })).status).toBe(404);
    expect((await app.request(`/api/library/${work.id}`, { method: 'POST' })).status).toBe(401);
    expect(
      (
        await app.request(`/api/library/${work.id}`, {
          method: 'POST',
          headers: { cookie: learner.cookie },
        })
      ).status,
    ).toBe(404);
    expect((await app.request('/api/library', { headers: { cookie: learner.cookie } })).status).toBe(200);
  });
});
