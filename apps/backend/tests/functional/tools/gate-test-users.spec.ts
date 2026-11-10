import { randomBytes, randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { user as userTable } from '@gloaming/db';
import { AUTH_ADMIN_ROLE } from '@gloaming/shared/auth';

import app from '@/app';
import { db } from '@/infra/db';

/**
 * Local Gate bootstrap: opt in with GLOAMING_GATE_BOOTSTRAP_USERS=1 and set
 * GLOAMING_GATE_CREDENTIALS_PATH to a new file under /private/tmp.
 * Creates two verified users and one role-backed admin in gloaming_test.
 */
const { sendAuthMailMock } = vi.hoisted(() => ({
  sendAuthMailMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/infra/auth/mail', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, sendAuthMail: sendAuthMailMock };
});

const enabled = process.env.GLOAMING_GATE_BOOTSTRAP_USERS === '1';
const createdEmails: string[] = [];

type TestUser = {
  role: 'user' | 'admin';
  name: string;
  email: string;
  username: string;
  password: string;
};

function assertSafeTestEnvironment(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Gate test user bootstrap refuses to run when NODE_ENV=production.');
  }

  const testUrl = process.env.TEST_DATABASE_URL?.trim();
  const activeUrl = process.env.DATABASE_URL?.trim();
  if (!testUrl || activeUrl !== testUrl) {
    throw new Error('Gate test user bootstrap requires DATABASE_URL to equal TEST_DATABASE_URL.');
  }

  let parsed: URL;
  try {
    parsed = new URL(testUrl);
  } catch {
    throw new Error('Gate test user bootstrap cannot parse TEST_DATABASE_URL.');
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, '').split('/')[0] ?? '');
  if (databaseName !== 'gloaming_test') {
    throw new Error('Gate test user bootstrap only permits the gloaming_test database.');
  }
  if (/prod/i.test(parsed.hostname)) {
    throw new Error('Gate test user bootstrap refuses a database host marked as production.');
  }
}

function cookieHeader(response: Response): string {
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
  if (getSetCookie?.length) return getSetCookie.map((entry) => entry.split(';')[0]).join('; ');
  const single = response.headers.get('set-cookie');
  return single ? single.split(';')[0]! : '';
}

async function createUser(role: TestUser['role'], runId: string): Promise<TestUser> {
  const suffix = randomBytes(5).toString('hex');
  const email = `gate-${role}-${runId}-${suffix}@example.test`;
  const username = `gate_${role}_${suffix}`;
  const password = randomBytes(24).toString('base64url');
  createdEmails.push(email);
  const signup = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password, name: `Gate ${role}`, username }),
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
  const cookie = cookieHeader(login);
  expect(cookie).toContain('better-auth.session_token');
  const session = await app.request('/api/auth/get-session', { headers: { cookie } });
  expect(session.status).toBe(200);

  return { role, name: `Gate ${role}`, email, username, password };
}

describe.skipIf(!enabled)('local Integration Gate test users', () => {
  it('creates verified browser accounts on the isolated test database', async () => {
    assertSafeTestEnvironment();
    const credentialsPath = path.resolve(process.env.GLOAMING_GATE_CREDENTIALS_PATH ?? '');
    if (!credentialsPath.startsWith('/private/tmp/')) {
      throw new Error('Set GLOAMING_GATE_CREDENTIALS_PATH to a new file under /private/tmp.');
    }

    const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    try {
      const users: TestUser[] = [];
      users.push(await createUser('user', runId));
      users.push(await createUser('user', runId));
      users.push(await createUser('admin', runId));
      const output = await open(credentialsPath, 'wx', 0o600);
      try {
        await output.writeFile(`${JSON.stringify({ createdAt: new Date().toISOString(), users }, null, 2)}\n`, 'utf8');
      } finally {
        await output.close();
      }
      console.info(`Created two verified users and one admin test user. Credentials saved to ${credentialsPath}`);
    } catch (error) {
      for (const email of createdEmails) {
        await db.delete(userTable).where(eq(userTable.email, email));
      }
      throw error;
    }
  });
});
