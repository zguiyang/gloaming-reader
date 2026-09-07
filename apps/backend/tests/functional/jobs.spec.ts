import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { user as userTable } from '@gloaming/db';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';

import app from '@/app';
import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { JOB_PING } from '@/jobs/ping';
import { closeQueue, getQueue } from '@/lib/queue';

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

async function createSession(role: 'user' | 'admin') {
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

describe('POST /api/admin/jobs/ping', () => {
  const createdEmails: string[] = [];

  afterAll(async () => {
    for (const email of createdEmails) {
      await db.delete(userTable).where(eq(userTable.email, email));
    }
    await closeQueue();
  });

  it('rejects anonymous and non-admin callers', async () => {
    const anonymous = await app.request('/api/admin/jobs/ping', { method: 'POST' });
    expect(anonymous.status).toBe(HTTP_STATUS.UNAUTHORIZED);

    const user = await createSession('user');
    createdEmails.push(user.email);
    const forbidden = await app.request('/api/admin/jobs/ping', {
      method: 'POST',
      headers: { cookie: user.cookie },
    });
    expect(forbidden.status).toBe(HTTP_STATUS.FORBIDDEN);
  });

  it('enqueues a ping job for an admin', async () => {
    const admin = await createSession('admin');
    createdEmails.push(admin.email);

    const response = await app.request('/api/admin/jobs/ping', {
      method: 'POST',
      headers: { cookie: admin.cookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id?: string };
    expect(body.id).toBeTruthy();

    const job = await getQueue().getJob(body.id!);
    expect(job?.name).toBe(JOB_PING);
    await job?.remove().catch(() => {});
  });
});
