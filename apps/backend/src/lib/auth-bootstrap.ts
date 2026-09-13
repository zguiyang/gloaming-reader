import { count, sql } from 'drizzle-orm';

import * as schema from '@gloaming/db/schema';
import { type AuthRole, bootstrapRoleForNewUser } from '@gloaming/shared/auth';

import { db } from '@/db';

/** Stable advisory lock key for first-user admin bootstrap. */
export const FIRST_USER_BOOTSTRAP_LOCK_KEY = 7_901_001;

type BootstrapDb = Pick<typeof db, 'execute' | 'select'>;

/**
 * Atomically decide the role for a new user.
 * Uses a transaction-scoped advisory lock so concurrent first signups cannot both become admin.
 */
export async function resolveBootstrapRoleForNewUser(database: BootstrapDb = db): Promise<AuthRole> {
  await database.execute(sql`select pg_advisory_xact_lock(${FIRST_USER_BOOTSTRAP_LOCK_KEY})`);
  const [row] = await database.select({ value: count() }).from(schema.user);
  const existingUserCount = Number(row?.value ?? 0);
  return bootstrapRoleForNewUser(existingUserCount);
}
