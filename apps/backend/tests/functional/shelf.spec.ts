import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { readingWork as readingWorkTable, user as userTable } from '@gloaming/db';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';
import type { ShelfData } from '@gloaming/shared/shelf';
import type { AdminWork } from '@gloaming/shared/works';

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

describe('Shelf HTTP', () => {
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

  it('returns empty shelf, then current + items after reading', async () => {
    const admin = await createSession('admin');
    const learner = await createSession('user');
    createdEmails.push(admin.email, learner.email);

    async function createAndPublish(title: string): Promise<AdminWork> {
      const create = await app.request('/api/admin/works', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
        body: JSON.stringify({
          title,
          body: `${title} body for shelf.`,
        }),
      });
      expect(create.status).toBe(201);
      const work = (await create.json()) as AdminWork;
      expect(
        (
          await app.request(`/api/admin/works/${work.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
            body: JSON.stringify({ sources: ['demo'], tags: ['story'] }),
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await app.request(`/api/admin/works/${work.id}/publish`, {
            method: 'POST',
            headers: { cookie: admin.cookie },
          })
        ).status,
      ).toBe(200);
      return work;
    }

    const emptyShelf = await app.request('/api/shelf', { headers: { cookie: learner.cookie } });
    expect(emptyShelf.status).toBe(200);
    expect((await emptyShelf.json()) as ShelfData).toEqual({ current: null, items: [] });

    const first = await createAndPublish('Shelf First');
    const second = await createAndPublish('Shelf Second');
    createdWorkIds.push(first.id, second.id);

    expect(
      (
        await app.request(`/api/reader/works/${first.id}/state`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', cookie: learner.cookie },
          body: JSON.stringify({ action: 'open' }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/api/reader/works/${first.id}/state`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', cookie: learner.cookie },
          body: JSON.stringify({ action: 'finish' }),
        })
      ).status,
    ).toBe(200);

    expect(
      (
        await app.request(`/api/reader/works/${second.id}/state`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', cookie: learner.cookie },
          body: JSON.stringify({ action: 'open' }),
        })
      ).status,
    ).toBe(200);

    const shelf = await app.request('/api/shelf', { headers: { cookie: learner.cookie } });
    expect(shelf.status).toBe(200);
    const shelfData = (await shelf.json()) as ShelfData;
    expect(shelfData.current?.work.id).toBe(second.id);
    expect(shelfData.current?.state.progressRatio).toBe(0);
    expect(shelfData.items).toHaveLength(1);
    expect(shelfData.items[0]?.work.id).toBe(first.id);
    expect(shelfData.items[0]?.state.status).toBe('completed');

    const readerCurrent = await app.request(`/api/reader/works/${second.id}/state`, {
      headers: { cookie: learner.cookie },
    });
    const readerCompleted = await app.request(`/api/reader/works/${first.id}/state`, {
      headers: { cookie: learner.cookie },
    });
    const readerCurrentData = (await readerCurrent.json()) as {
      state: NonNullable<ShelfData['current']>['state'];
    };
    const readerCompletedData = (await readerCompleted.json()) as { state: ShelfData['items'][number]['state'] };
    expect(shelfData.current?.state).toEqual(readerCurrentData.state);
    expect(shelfData.items[0]?.state).toEqual(readerCompletedData.state);
  });
});
