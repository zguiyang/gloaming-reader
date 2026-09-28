import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { readingPart as readingPartTable, readingWork as readingWorkTable, user as userTable } from '@gloaming/db';
import type { RecommendationsData } from '@gloaming/shared/recommendations';

import app from '@/app';
import { db } from '@/infra/db';

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

async function signInEmail(email: string) {
  return app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password }),
  });
}

async function createSession() {
  const email = uniqueEmail('recs');
  const username = `recs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  expect((await signUp({ email, username, name: 'learner' })).status).toBe(200);
  await markEmailVerified(email);
  const login = await signInEmail(email);
  expect(login.status).toBe(200);
  const [row] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, email)).limit(1);
  return { email, cookie: cookieHeader(login), userId: row!.id };
}

async function seedWork(input: {
  title: string;
  ownerUserId: string | null;
  visibility: 'catalog' | 'private';
  publishedAt: Date | null;
}) {
  const workId = randomUUID();
  await db.insert(readingWorkTable).values({
    id: workId,
    title: input.title,
    processingStatus: 'ready',
    visibility: input.visibility,
    ownerUserId: input.ownerUserId,
    publishedAt: input.publishedAt,
  });
  await db.insert(readingPartTable).values({
    id: randomUUID(),
    workId,
    sortOrder: 0,
    kind: 'body',
    title: 'Body',
    body: '<p>Recommendations catalog policy test.</p>',
  });
  return workId;
}

describe('GET /api/recommendations catalog candidate policy', () => {
  const createdEmails: string[] = [];
  const createdWorkIds: string[] = [];

  afterAll(async () => {
    if (createdWorkIds.length > 0) {
      await db.delete(readingPartTable).where(inArray(readingPartTable.workId, createdWorkIds));
      await db.delete(readingWorkTable).where(inArray(readingWorkTable.id, createdWorkIds));
    }
    for (const email of createdEmails) {
      await db.delete(userTable).where(eq(userTable.email, email));
    }
  });

  it('includes official public catalog works and excludes user-owned catalog-shaped rows', async () => {
    const learner = await createSession();
    createdEmails.push(learner.email);

    const ownerEmail = uniqueEmail('owner');
    const ownerUsername = `owner_${Date.now().toString(36)}`;
    expect((await signUp({ email: ownerEmail, username: ownerUsername, name: 'owner' })).status).toBe(200);
    await markEmailVerified(ownerEmail);
    const [ownerRow] = await db
      .select({ id: userTable.id })
      .from(userTable)
      .where(eq(userTable.email, ownerEmail))
      .limit(1);
    createdEmails.push(ownerEmail);

    const publishedAt = new Date('2026-01-15T12:00:00.000Z');
    const publicCatalogWorkId = await seedWork({
      title: `Public catalog recs ${randomUUID().slice(0, 8)}`,
      ownerUserId: null,
      visibility: 'catalog',
      publishedAt,
    });
    const userOwnedCatalogShapedId = await seedWork({
      title: `User-owned catalog-shaped recs ${randomUUID().slice(0, 8)}`,
      ownerUserId: ownerRow!.id,
      visibility: 'catalog',
      publishedAt,
    });
    createdWorkIds.push(publicCatalogWorkId, userOwnedCatalogShapedId);

    const response = await app.request('/api/recommendations?limit=10', {
      headers: { cookie: learner.cookie },
    });
    expect(response.status).toBe(200);

    const data = (await response.json()) as RecommendationsData;
    const returnedIds = data.items.map((item) => item.id);

    expect(returnedIds).toContain(publicCatalogWorkId);
    expect(returnedIds).not.toContain(userOwnedCatalogShapedId);
  });
});
