import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { user as userTable, verification as verificationTable } from '@gloaming/db';
import { AUTH_ADMIN_ROLE, AUTH_USER_ROLE } from '@gloaming/shared/auth';

import app from '@/app';
import { db } from '@/db';

const password = 'password123';
const newPassword = 'password456';

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

async function signInUsername(username: string) {
  return app.request('/api/auth/sign-in/username', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ username, password }),
  });
}

describe('Better Auth HTTP', () => {
  const createdEmails: string[] = [];

  beforeAll(() => {
    // env/db boot via app import
  });

  afterAll(async () => {
    for (const email of createdEmails) {
      await db.delete(userTable).where(eq(userTable.email, email));
    }
  });

  it('registers with username + role defaults and blocks unverified sign-in', async () => {
    const email = uniqueEmail('alice');
    const username = `alice_${Date.now().toString(36)}`;
    createdEmails.push(email);

    const register = await signUp({ email, username, name: 'Alice' });
    expect(register.status).toBe(200);
    const registerBody = (await register.json()) as { user?: { email?: string; username?: string; role?: string } };
    expect(registerBody.user?.email).toBe(email);
    expect(registerBody.user?.username).toBe(username);
    expect(registerBody.user?.role ?? 'user').toBe('user');

    const blocked = await signInEmail(email);
    expect(blocked.status).toBe(403);
    const blockedBody = (await blocked.json()) as { code?: string };
    expect(blockedBody.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('allows verified email/username sign-in, get-session, protected /api/me, and sign-out', async () => {
    const email = uniqueEmail('bob');
    const username = `bob_${Date.now().toString(36)}`;
    createdEmails.push(email);

    const register = await signUp({ email, username, name: 'Bob' });
    expect(register.status).toBe(200);
    await markEmailVerified(email);

    const loginEmail = await signInEmail(email);
    expect(loginEmail.status).toBe(200);
    const cookie = cookieHeader(loginEmail);
    expect(cookie).toContain('better-auth.session_token');

    const meAuthed = await app.request('/api/me', {
      headers: { cookie },
    });
    expect(meAuthed.status).toBe(200);
    const meBody = (await meAuthed.json()) as { email?: string; username?: string };
    expect(meBody.email).toBe(email);
    expect(meBody.username).toBe(username);

    const meAnon = await app.request('/api/me');
    expect(meAnon.status).toBe(401);
    await expect(meAnon.json()).resolves.toEqual({ error: 'Unauthorized' });

    const loginUsername = await signInUsername(username);
    expect(loginUsername.status).toBe(200);

    const session = await app.request('/api/auth/get-session', {
      headers: { cookie },
    });
    expect(session.status).toBe(200);

    const signOut = await app.request('/api/auth/sign-out', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        cookie,
      },
      body: JSON.stringify({}),
    });
    expect(signOut.status).toBe(200);

    const meAfter = await app.request('/api/me', {
      headers: { cookie },
    });
    expect(meAfter.status).toBe(401);
  });

  it('verifies email via GET /api/auth/verify-email without callbackURL (JSON)', async () => {
    const { signJWT } = await import('better-auth/crypto');
    const email = uniqueEmail('dana');
    const username = `dana_${Date.now().toString(36)}`;
    createdEmails.push(email);

    expect((await signUp({ email, username, name: 'Dana' })).status).toBe(200);

    const token = await signJWT({ email: email.toLowerCase() }, process.env.BETTER_AUTH_SECRET!, 3600);
    const verify = await app.request(`/api/auth/verify-email?token=${encodeURIComponent(token)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    expect(verify.status).toBe(200);
    const body = (await verify.json()) as { status?: boolean };
    expect(body.status).toBe(true);

    const [row] = await db
      .select({ emailVerified: userTable.emailVerified })
      .from(userTable)
      .where(eq(userTable.email, email));
    expect(row?.emailVerified).toBe(true);

    const login = await signInEmail(email);
    expect(login.status).toBe(200);
  });

  it('returns 401 on protected probe without session', async () => {
    const response = await app.request('/api/me');
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('guards admin probe by authenticated admin role', async () => {
    const anonymous = await app.request('/api/admin/probe');
    expect(anonymous.status).toBe(401);
    await expect(anonymous.json()).resolves.toEqual({ error: 'Unauthorized' });

    const userEmail = uniqueEmail('regular-admin-probe');
    const userUsername = `regular_${Date.now().toString(36)}`;
    createdEmails.push(userEmail);
    expect((await signUp({ email: userEmail, username: userUsername, name: 'Regular' })).status).toBe(200);
    await markEmailVerified(userEmail);

    const userLogin = await signInEmail(userEmail);
    expect(userLogin.status).toBe(200);
    const userDenied = await app.request('/api/admin/probe', {
      headers: { cookie: cookieHeader(userLogin) },
    });
    expect(userDenied.status).toBe(403);
    await expect(userDenied.json()).resolves.toEqual({ error: 'Forbidden' });

    const adminEmail = uniqueEmail('admin-probe');
    const adminUsername = `admin_${Date.now().toString(36)}`;
    createdEmails.push(adminEmail);
    expect((await signUp({ email: adminEmail, username: adminUsername, name: 'Admin' })).status).toBe(200);
    await markEmailVerified(adminEmail);
    await setUserRole(adminEmail, AUTH_ADMIN_ROLE);

    const adminLogin = await signInEmail(adminEmail);
    expect(adminLogin.status).toBe(200);
    const adminAllowed = await app.request('/api/admin/probe', {
      headers: { cookie: cookieHeader(adminLogin) },
    });
    expect(adminAllowed.status).toBe(200);
    const adminBody = (await adminAllowed.json()) as { role?: string };
    expect(adminBody.role).toBe(AUTH_ADMIN_ROLE);

    await setUserRole(adminEmail, AUTH_USER_ROLE);
  });

  it('resets password via BA endpoints and revokes prior sessions', async () => {
    const email = uniqueEmail('carol');
    const username = `carol_${Date.now().toString(36)}`;
    createdEmails.push(email);

    expect((await signUp({ email, username, name: 'Carol' })).status).toBe(200);
    await markEmailVerified(email);

    const login = await signInEmail(email);
    expect(login.status).toBe(200);
    const cookie = cookieHeader(login);
    expect(cookie).toContain('better-auth.session_token');

    const [dbUser] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, email));
    expect(dbUser?.id).toBeTruthy();

    const forgot = await app.request('/api/auth/request-password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        email,
        redirectTo: 'http://localhost:3000/reset-password',
      }),
    });
    expect(forgot.status).toBe(200);

    const [resetRow] = await db
      .select()
      .from(verificationTable)
      .where(and(eq(verificationTable.value, dbUser!.id), like(verificationTable.identifier, 'reset-password:%')));
    expect(resetRow?.identifier).toMatch(/^reset-password:/);
    const token = resetRow!.identifier.replace(/^reset-password:/, '');

    const reset = await app.request('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ token, newPassword }),
    });
    expect(reset.status).toBe(200);

    const meAfterReset = await app.request('/api/me', { headers: { cookie } });
    expect(meAfterReset.status).toBe(401);

    const oldPasswordLogin = await signInEmail(email);
    expect(oldPasswordLogin.status).not.toBe(200);

    const newLogin = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ email, password: newPassword }),
    });
    expect(newLogin.status).toBe(200);
  });
});
