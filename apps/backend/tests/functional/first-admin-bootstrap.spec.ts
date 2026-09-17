import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { user as userTable } from '@gloaming/db';
import { AUTH_USER_ROLE } from '@gloaming/shared/auth';

import app from '@/app';
import { db } from '@/db';

const password = 'password123';

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

describe('auth role assignment', () => {
  const createdEmails: string[] = [];

  afterAll(async () => {
    for (const email of createdEmails) {
      await db.delete(userTable).where(eq(userTable.email, email));
    }
  });

  it('assigns user to every public registrant', async () => {
    const firstEmail = uniqueEmail('race-first');
    const secondEmail = uniqueEmail('race-second');
    const firstUsername = `race_first_${Date.now().toString(36)}`;
    const secondUsername = `race_second_${Date.now().toString(36)}`;
    createdEmails.push(firstEmail, secondEmail);

    const [firstRegister, secondRegister] = await Promise.all([
      signUp({ email: firstEmail, username: firstUsername, name: 'Race First' }),
      signUp({ email: secondEmail, username: secondUsername, name: 'Race Second' }),
    ]);

    expect(firstRegister.status).toBe(200);
    expect(secondRegister.status).toBe(200);

    const roles = [
      ((await firstRegister.json()) as { user?: { role?: string } }).user?.role,
      ((await secondRegister.json()) as { user?: { role?: string } }).user?.role,
    ];
    expect(roles).toEqual([AUTH_USER_ROLE, AUTH_USER_ROLE]);
  });
});
