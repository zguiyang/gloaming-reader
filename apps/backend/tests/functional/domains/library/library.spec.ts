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
  userTag as userTagTable,
  userWorkTag as userWorkTagTable,
} from '@gloaming/db';
import type { LibraryData } from '@gloaming/shared/library';
import { LIBRARY_ITEMS_LIMIT } from '@gloaming/shared/library';

import app from '@/app';
import { db } from '@/infra/db';

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

async function createSession() {
  const email = uniqueEmail('user');
  const username = `user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const signup = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password, name: 'user', username }),
  });
  expect(signup.status).toBe(200);
  await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.email, email));
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
    const learner = await createSession();
    createdEmails.push(learner.email);

    const work = await createCatalogWorkFixture({ title: 'Library Ocean', body: 'The sea is wide.' });
    createdWorkIds.push(work.id);

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
    expect(savedData.items.find((item) => item.work.id === work.id)).toMatchObject({
      availability: 'ready',
      libraryItemKind: 'saved_catalog',
      personalMetadata: null,
      canRemoveFromLibrary: true,
    });
    expect(
      await db
        .select()
        .from(userLibraryItemTable)
        .where(and(eq(userLibraryItemTable.userId, learner.userId), eq(userLibraryItemTable.workId, work.id))),
    ).toHaveLength(1);

    const tagResponse = await app.request('/api/library/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: learner.cookie },
      body: JSON.stringify({ name: ' Favorite ' }),
    });
    expect(tagResponse.status).toBe(201);
    const tag = (await tagResponse.json()) as { id: string; name: string };
    expect(tag.name).toBe('Favorite');
    expect(
      (
        await app.request(`/api/library/${work.id}/tags/${tag.id}`, {
          method: 'PUT',
          headers: { cookie: learner.cookie },
        })
      ).status,
    ).toBe(204);
    const tagged = await (await app.request('/api/library', { headers: { cookie: learner.cookie } })).json();
    expect(((tagged as LibraryData).items.find((item) => item.work.id === work.id)?.userTags ?? [])[0]?.id).toBe(
      tag.id,
    );

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
    expect(
      await db
        .select()
        .from(userWorkTagTable)
        .where(and(eq(userWorkTagTable.userId, learner.userId), eq(userWorkTagTable.workId, work.id))),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(userTagTable)
        .where(and(eq(userTagTable.userId, learner.userId), eq(userTagTable.id, tag.id))),
    ).toHaveLength(1);
    expect(await db.select().from(readingDayTable).where(eq(readingDayTable.userId, learner.userId))).toHaveLength(1);
  });

  it('includes Personal ownership and never creates a saved Catalog row for Personal Works', async () => {
    const owner = await createSession();
    const other = await createSession();
    createdEmails.push(owner.email, other.email);
    const workId = randomUUID();
    const processingWorkId = randomUUID();
    const failedWorkId = randomUUID();
    createdWorkIds.push(workId, processingWorkId, failedWorkId);
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
    await db.insert(readingWorkTable).values([
      {
        id: processingWorkId,
        title: 'Personal Work Processing',
        ownerUserId: owner.userId,
        visibility: 'private',
        originKind: 'user_epub',
        processingStatus: 'metadata',
      },
      {
        id: failedWorkId,
        title: 'Personal Work Failed',
        ownerUserId: owner.userId,
        visibility: 'private',
        originKind: 'user_epub',
        processingStatus: 'failed',
      },
    ]);

    const ownerLibrary = await app.request('/api/library', { headers: { cookie: owner.cookie } });
    const ownerData = (await ownerLibrary.json()) as LibraryData;
    expect(ownerData.items.map((item) => item.work.id)).toContain(workId);
    expect(ownerData.items.find((item) => item.work.id === workId)).toMatchObject({
      state: null,
      availability: 'ready',
      libraryItemKind: 'personal',
      personalMetadata: { author: '' },
      canRemoveFromLibrary: false,
    });
    expect(ownerData.items.find((item) => item.work.id === processingWorkId)?.availability).toBe('processing');
    expect(ownerData.items.find((item) => item.work.id === failedWorkId)?.availability).toBe('failed');
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
    const learner = await createSession();
    createdEmails.push(learner.email);
    const work = await createCatalogWorkFixture({
      title: 'Unpublished Library Work',
      body: 'Not published.',
      publishedAt: null,
    });
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

  it('flags isTruncated only when Personal plus saved memberships exceed the returned page', async () => {
    const small = await createSession();
    const exact = await createSession();
    const over = await createSession();
    createdEmails.push(small.email, exact.email, over.email);

    const makeIds = (count: number) => Array.from({ length: count }, () => randomUUID());
    const personalWork = (id: string, ownerUserId: string) => ({
      id,
      title: `Truncation personal ${id}`,
      ownerUserId,
      visibility: 'private' as const,
      originKind: 'user_epub' as const,
      processingStatus: 'ready',
    });
    const smallPersonal = makeIds(12);
    const exactPersonal = makeIds(40);
    const overPersonal = makeIds(40);
    const smallSaved = makeIds(10);
    const exactSaved = makeIds(8);
    const overSaved = makeIds(9);
    createdWorkIds.push(
      ...smallPersonal,
      ...exactPersonal,
      ...overPersonal,
      ...smallSaved,
      ...exactSaved,
      ...overSaved,
    );

    await db.insert(readingWorkTable).values([
      ...smallPersonal.map((id) => personalWork(id, small.userId)),
      ...exactPersonal.map((id) => personalWork(id, exact.userId)),
      ...overPersonal.map((id) => personalWork(id, over.userId)),
      ...[...smallSaved, ...exactSaved, ...overSaved].map((id) => ({
        id,
        title: `Truncation catalog ${id}`,
        ownerUserId: null,
        visibility: 'catalog' as const,
        publishedAt: new Date(),
        processingStatus: 'ready',
      })),
    ]);
    await db
      .insert(userLibraryItemTable)
      .values([
        ...smallSaved.map((workId) => ({ id: randomUUID(), userId: small.userId, workId })),
        ...exactSaved.map((workId) => ({ id: randomUUID(), userId: exact.userId, workId })),
        ...overSaved.map((workId) => ({ id: randomUUID(), userId: over.userId, workId })),
      ]);

    const fetchLibrary = async (session: { cookie: string }) => {
      const response = await app.request('/api/library', { headers: { cookie: session.cookie } });
      expect(response.status).toBe(200);
      return (await response.json()) as LibraryData;
    };

    // 12 Personal + 10 saved memberships: every membership is returned, so nothing is hidden.
    const smallLibrary = await fetchLibrary(small);
    expect(smallLibrary.isTruncated).toBe(false);
    expect(smallLibrary.items).toHaveLength(22);
    expect(smallLibrary.items.filter((item) => item.libraryItemKind === 'personal')).toHaveLength(12);
    expect(smallLibrary.items.filter((item) => item.libraryItemKind === 'saved_catalog')).toHaveLength(10);

    // Exactly at the ceiling: the mixed total still equals the page size.
    const exactLibrary = await fetchLibrary(exact);
    expect(exactLibrary.isTruncated).toBe(false);
    expect(exactLibrary.items).toHaveLength(LIBRARY_ITEMS_LIMIT);

    // One membership past the ceiling: the page stays capped and only the marker flips.
    const overLibrary = await fetchLibrary(over);
    expect(overLibrary.isTruncated).toBe(true);
    expect(overLibrary.items).toHaveLength(LIBRARY_ITEMS_LIMIT);
    const overPersonalCount = overLibrary.items.filter((item) => item.libraryItemKind === 'personal').length;
    const overSavedCount = overLibrary.items.filter((item) => item.libraryItemKind === 'saved_catalog').length;
    // Exactly one of the 49 memberships is hidden; which one depends only on the sort order.
    expect(overPersonalCount + overSavedCount).toBe(LIBRARY_ITEMS_LIMIT);
    expect([
      [40, 8],
      [39, 9],
    ]).toContainEqual([overPersonalCount, overSavedCount]);
  });
});
