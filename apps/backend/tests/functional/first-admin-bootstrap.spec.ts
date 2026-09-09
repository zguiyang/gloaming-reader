import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { user as userTable } from '@gloaming/db';
import { AUTH_ADMIN_ROLE, AUTH_USER_ROLE } from '@gloaming/shared/auth';

import app from '@/app';
import { db } from '@/db';

const password = 'password123';
const BOOTSTRAP_ADMIN_ID = 'vitest-bootstrap-admin';

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

async function restoreHarnessBootstrapAdmin(): Promise<void> {
  const [existing] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.id, BOOTSTRAP_ADMIN_ID));
  if (existing) {
    return;
  }

  await db.insert(userTable).values({
    id: BOOTSTRAP_ADMIN_ID,
    name: 'Vitest Bootstrap',
    email: 'vitest-bootstrap-admin@example.com',
    emailVerified: true,
    username: 'vitest_bootstrap_admin',
    displayUsername: 'vitest_bootstrap_admin',
    role: AUTH_ADMIN_ROLE,
  });
}

describe('first admin bootstrap', () => {
  const createdEmails: string[] = [];

  afterAll(async () => {
    for (const email of createdEmails) {
      await db.delete(userTable).where(eq(userTable.email, email));
    }
    await restoreHarnessBootstrapAdmin();
  });

  it('assigns admin only to the first registrant on an empty user table', async () => {
    await db.delete(userTable);

    const firstEmail = uniqueEmail('first-admin');
    const firstUsername = `first_${Date.now().toString(36)}`;
    createdEmails.push(firstEmail);

    const firstRegister = await signUp({ email: firstEmail, username: firstUsername, name: 'First' });
    expect(firstRegister.status).toBe(200);
    const firstBody = (await firstRegister.json()) as { user?: { role?: string } };
    expect(firstBody.user?.role).toBe(AUTH_ADMIN_ROLE);

    const secondEmail = uniqueEmail('second-user');
    const secondUsername = `second_${Date.now().toString(36)}`;
    createdEmails.push(secondEmail);

    const secondRegister = await signUp({ email: secondEmail, username: secondUsername, name: 'Second' });
    expect(secondRegister.status).toBe(200);
    const secondBody = (await secondRegister.json()) as { user?: { role?: string } };
    expect(secondBody.user?.role).toBe(AUTH_USER_ROLE);
  });
});
