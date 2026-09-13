import { randomUUID } from 'node:crypto';

import { count } from 'drizzle-orm';

import * as schema from '@gloaming/db/schema';
import { AUTH_USER_ROLE, type AuthRole, bootstrapRoleForNewUser } from '@gloaming/shared/auth';

import { db } from '@/db';
import { acquireLockWithWait, releaseLock } from '@/lib/redis-lock';

/** Redis key for cross-instance first-user bootstrap serialization. */
export const FIRST_USER_BOOTSTRAP_LOCK_KEY = 'gloaming:auth:first-user-bootstrap:lock';
export const FIRST_USER_BOOTSTRAP_LOCK_TTL_SECONDS = 30;
export const FIRST_USER_BOOTSTRAP_LOCK_MAX_WAIT_MS = 5_000;

type BootstrapDb = Pick<typeof db, 'select'>;

/**
 * In-memory map from signup correlation key to the Redis lock token.
 * Released from Better Auth user.create.after; TTL is the safety net when INSERT fails.
 */
const pendingBootstrapLocks = new Map<string, string>();

function normalizeCorrelationKey(correlationKey: string): string {
  return correlationKey.trim().toLowerCase();
}

async function countExistingUsers(database: BootstrapDb): Promise<number> {
  const [row] = await database.select({ value: count() }).from(schema.user);
  return Number(row?.value ?? 0);
}

/**
 * Decide the bootstrap role for a new user under a Redis distributed lock.
 *
 * Better Auth lifecycle (better-auth/dist/db/with-hooks.mjs):
 * - databaseHooks.user.create.before runs, then adapter.create INSERT runs in the same
 *   request but not in the same DB transaction as ad-hoc queries on the default pool.
 * - databaseHooks.user.create.after is queued via queueAfterTransactionHook and runs
 *   after the signup transaction commits (see @better-auth/core/context/transaction.mjs).
 *
 * Guarantee boundary: one global Redis lock serializes "count users → assign role → INSERT"
 * across API instances. The lock is acquired here and released in
 * {@link releaseBootstrapUserCreation} from user.create.after, with TTL as fallback.
 */
export async function resolveBootstrapRoleForNewUser(
  correlationKey: string,
  database: BootstrapDb = db,
): Promise<AuthRole> {
  const key = normalizeCorrelationKey(correlationKey);
  const token = randomUUID();
  const acquired = await acquireLockWithWait(
    FIRST_USER_BOOTSTRAP_LOCK_KEY,
    token,
    FIRST_USER_BOOTSTRAP_LOCK_TTL_SECONDS,
    { maxWaitMs: FIRST_USER_BOOTSTRAP_LOCK_MAX_WAIT_MS },
  );

  if (!acquired) {
    // Fail closed on admin: prefer a regular user over a duplicate admin when lock contention times out.
    return AUTH_USER_ROLE;
  }

  try {
    const role = bootstrapRoleForNewUser(await countExistingUsers(database));
    pendingBootstrapLocks.set(key, token);
    return role;
  } catch (error) {
    await releaseLock(FIRST_USER_BOOTSTRAP_LOCK_KEY, token);
    throw error;
  }
}

/** Release the bootstrap lock after Better Auth finishes inserting the user row. */
export async function releaseBootstrapUserCreation(correlationKey: string): Promise<void> {
  const key = normalizeCorrelationKey(correlationKey);
  const token = pendingBootstrapLocks.get(key);
  if (!token) {
    return;
  }

  pendingBootstrapLocks.delete(key);
  await releaseLock(FIRST_USER_BOOTSTRAP_LOCK_KEY, token);
}
