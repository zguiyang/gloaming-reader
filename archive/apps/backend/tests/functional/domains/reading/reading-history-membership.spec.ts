import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  readingPart as readingPartTable,
  readingState as readingStateTable,
  readingWork as readingWorkTable,
  user as userTable,
  userLibraryItem as userLibraryItemTable,
} from '@gloaming/db';
import { discoverySource as discoverySourceTable, sourceRecord as sourceRecordTable } from '@gloaming/db/schema';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';
import type { ReadingHistoryData } from '@gloaming/shared/reading-history';

import app from '@/app';
import { db } from '@/infra/db';
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

async function seedReadingState(userId: string, workId: string, partId: string | null) {
  await db.insert(readingStateTable).values({
    id: randomUUID(),
    userId,
    workId,
    currentPartId: partId,
    completedThroughSortOrder: -1,
    status: 'in_progress',
    addedAt: new Date(),
    lastReadAt: new Date(),
    completedAt: null,
  });
}

async function getHistory(cookie: string): Promise<ReadingHistoryData> {
  const response = await app.request('/api/reading-history', { headers: { cookie } });
  expect(response.status).toBe(200);
  return (await response.json()) as ReadingHistoryData;
}

describe('Reading history Work Access Policy on gloaming_test', () => {
  const runId = randomUUID();
  const createdEmails: string[] = [];
  const createdWorkIds: string[] = [];
  let sourceId = '';

  beforeAll(async () => {
    sourceId = randomUUID();
    await db.insert(discoverySourceTable).values({
      id: sourceId,
      sourceKey: `history_access_test_${runId}`,
      sourceType: 'gutenberg_rdf',
    });
  });

  afterAll(async () => {
    if (createdWorkIds.length) {
      await db.delete(readingWorkTable).where(inArray(readingWorkTable.id, createdWorkIds));
    }
    await db.delete(discoverySourceTable).where(eq(discoverySourceTable.id, sourceId));
    for (const email of createdEmails) {
      await db.delete(userTable).where(eq(userTable.email, email));
    }
  });

  it('includes a membership-saved unpublished Source Work and excludes non-members and owners', async () => {
    const member = await createSession();
    const outsider = await createSession();
    const admin = await createSession('admin');
    createdEmails.push(member.email, outsider.email, admin.email);

    const sourceWork = await createCatalogWorkFixture({ title: 'History Source Work', publishedAt: null });
    createdWorkIds.push(sourceWork.id);
    await db.insert(sourceRecordTable).values({
      id: randomUUID(),
      sourceId,
      externalId: `${runId}-${sourceWork.id}`,
      title: 'History Source Work',
      availability: 'available',
      workId: sourceWork.id,
      materializationStatus: 'ready',
    });
    const partId = sourceWork.parts[0]!.id;
    await seedReadingState(member.userId, sourceWork.id, partId);
    await seedReadingState(outsider.userId, sourceWork.id, partId);
    await seedReadingState(admin.userId, sourceWork.id, partId);

    await db.insert(userLibraryItemTable).values({ id: randomUUID(), userId: member.userId, workId: sourceWork.id });

    const memberHistory = await getHistory(member.cookie);
    expect(memberHistory.works.some((work) => work.workId === sourceWork.id)).toBe(true);

    const outsiderHistory = await getHistory(outsider.cookie);
    expect(outsiderHistory.works.some((work) => work.workId === sourceWork.id)).toBe(false);

    const adminHistory = await getHistory(admin.cookie);
    expect(adminHistory.works.some((work) => work.workId === sourceWork.id)).toBe(false);

    // An Admin with their own membership follows ordinary membership and is allowed.
    await db.insert(userLibraryItemTable).values({ id: randomUUID(), userId: admin.userId, workId: sourceWork.id });
    const adminWithMembership = await getHistory(admin.cookie);
    expect(adminWithMembership.works.some((work) => work.workId === sourceWork.id)).toBe(true);
  });

  it('preserves published Catalog public reads and Personal Work owner reads', async () => {
    const learner = await createSession();
    createdEmails.push(learner.email);

    const published = await createCatalogWorkFixture({ title: 'History Published Work' });
    createdWorkIds.push(published.id);
    await seedReadingState(learner.userId, published.id, published.parts[0]!.id);

    const personalWorkId = randomUUID();
    const personalPartId = randomUUID();
    createdWorkIds.push(personalWorkId);
    await db.insert(readingWorkTable).values({
      id: personalWorkId,
      title: 'History Personal Work',
      ownerUserId: learner.userId,
      visibility: 'private',
      originKind: 'user_epub',
      processingStatus: 'ready',
    });
    await db.insert(readingPartTable).values({
      id: personalPartId,
      workId: personalWorkId,
      sortOrder: 0,
      kind: 'chapter',
      title: 'Chapter',
      body: '<p>Personal body</p>',
      meta: {},
    });
    await seedReadingState(learner.userId, personalWorkId, personalPartId);

    const history = await getHistory(learner.cookie);
    expect(history.works.some((work) => work.workId === published.id)).toBe(true);
    expect(history.works.some((work) => work.workId === personalWorkId)).toBe(true);
  });

  it('denies non-owner Personal history and keeps published Catalog public across actors', async () => {
    const owner = await createSession();
    const other = await createSession();
    const admin = await createSession('admin');
    createdEmails.push(owner.email, other.email, admin.email);

    const personalWorkId = randomUUID();
    const personalPartId = randomUUID();
    createdWorkIds.push(personalWorkId);
    await db.insert(readingWorkTable).values({
      id: personalWorkId,
      title: 'History Personal Matrix',
      ownerUserId: owner.userId,
      visibility: 'private',
      originKind: 'user_epub',
      processingStatus: 'ready',
    });
    await db.insert(readingPartTable).values({
      id: personalPartId,
      workId: personalWorkId,
      sortOrder: 0,
      kind: 'chapter',
      title: 'Chapter',
      body: '<p>Personal body</p>',
      meta: {},
    });
    await seedReadingState(owner.userId, personalWorkId, personalPartId);
    await seedReadingState(other.userId, personalWorkId, personalPartId);
    await seedReadingState(admin.userId, personalWorkId, personalPartId);

    // A deliberately seeded Library membership on a Personal Work must not
    // unlock its history for non-owners.
    await db.insert(userLibraryItemTable).values([
      { id: randomUUID(), userId: other.userId, workId: personalWorkId },
      { id: randomUUID(), userId: admin.userId, workId: personalWorkId },
    ]);

    const published = await createCatalogWorkFixture({ title: 'History Published Matrix' });
    createdWorkIds.push(published.id);
    await seedReadingState(other.userId, published.id, published.parts[0]!.id);

    const ownerHistory = await getHistory(owner.cookie);
    expect(ownerHistory.works.some((work) => work.workId === personalWorkId)).toBe(true);

    const otherHistory = await getHistory(other.cookie);
    expect(otherHistory.works.some((work) => work.workId === personalWorkId)).toBe(false);
    expect(otherHistory.works.some((work) => work.workId === published.id)).toBe(true);

    const adminHistory = await getHistory(admin.cookie);
    expect(adminHistory.works.some((work) => work.workId === personalWorkId)).toBe(false);
  });

  it('requires authentication', async () => {
    expect((await app.request('/api/reading-history')).status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });
});
