import { count, eq } from 'drizzle-orm';

import { user as userTable } from '@gloaming/db';
import { AUTH_ADMIN_ROLE, AUTH_PASSWORD_POLICY, AUTH_USERNAME_POLICY, isValidUsername } from '@gloaming/shared/auth';

import { db } from '@/db';
import { auth } from '@/lib/auth';
import { withAdminBootstrap } from '@/lib/auth-bootstrap';

const ADMIN_NAME = 'Gloaming Admin';
const ADMIN_USERNAME = 'admin';

type AdminEnvKey = 'ADMIN_EMAIL' | 'ADMIN_PASSWORD';

type AdminCredentials = {
  email: string;
  password: string;
  name: string;
  username: string;
};

function requiredAdminEnv(name: AdminEnvKey, options?: { preserveWhitespace: boolean }): string {
  const value = process.env[name];
  const normalized = options?.preserveWhitespace ? value : value?.trim();
  if (!normalized) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return normalized;
}

function readAdminCredentials(): AdminCredentials {
  const email = requiredAdminEnv('ADMIN_EMAIL');
  const password = requiredAdminEnv('ADMIN_PASSWORD', { preserveWhitespace: true });
  const name = ADMIN_NAME;
  const username = ADMIN_USERNAME;

  if (password.length < AUTH_PASSWORD_POLICY.minLength || password.length > AUTH_PASSWORD_POLICY.maxLength) {
    throw new Error(
      `ADMIN_PASSWORD must be between ${AUTH_PASSWORD_POLICY.minLength} and ${AUTH_PASSWORD_POLICY.maxLength} characters.`,
    );
  }

  if (
    username.length < AUTH_USERNAME_POLICY.minLength ||
    username.length > AUTH_USERNAME_POLICY.maxLength ||
    !isValidUsername(username)
  ) {
    throw new Error(
      `ADMIN_USERNAME must be ${AUTH_USERNAME_POLICY.minLength}-${AUTH_USERNAME_POLICY.maxLength} characters and contain only letters, digits, dots, or underscores.`,
    );
  }

  return { email, password, name, username };
}

async function countAdmins(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(userTable).where(eq(userTable.role, AUTH_ADMIN_ROLE));
  return Number(row?.value ?? 0);
}

async function main(): Promise<void> {
  const adminCount = await countAdmins();
  if (adminCount > 0) {
    throw new Error('Refusing to run: an administrator already exists. This command can only be run once.');
  }

  const credentials = readAdminCredentials();
  const result = await withAdminBootstrap(() =>
    auth.api.signUpEmail({
      body: credentials,
    }),
  );

  if (!result.user || result.user.role !== AUTH_ADMIN_ROLE) {
    throw new Error(
      'Admin bootstrap did not produce an administrator account. Check the database state before retrying.',
    );
  }

  const [verifiedUser] = await db
    .update(userTable)
    .set({ emailVerified: true })
    .where(eq(userTable.id, result.user.id))
    .returning({ id: userTable.id, emailVerified: userTable.emailVerified });

  if (!verifiedUser?.emailVerified) {
    throw new Error('Admin account was created but could not be marked as email-verified. Check the database state.');
  }

  console.log(`Administrator created and verified for ${credentials.email}.`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error('Admin bootstrap failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
