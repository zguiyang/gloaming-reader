import { randomUUID } from 'node:crypto';

import { count } from 'drizzle-orm';

import * as schema from '@gloaming/db/schema';
import { type AuthRole, bootstrapRoleForNewUser } from '@gloaming/shared/auth';

import { db } from '@/db';
import {
  acquireLockWithWait,
  isLockHeldByToken,
  type LockRenewalHandle,
  releaseLock,
  startLockRenewal,
} from '@/lib/redis-lock';

/** Redis key for cross-instance first-user bootstrap serialization. */
export const FIRST_USER_BOOTSTRAP_LOCK_KEY = 'gloaming:auth:first-user-bootstrap:lock';
export const FIRST_USER_BOOTSTRAP_LOCK_TTL_SECONDS = 30;
export const FIRST_USER_BOOTSTRAP_LOCK_MAX_WAIT_MS = 5_000;
export const FIRST_USER_BOOTSTRAP_LOCK_RENEW_INTERVAL_MS = 10_000;
export const FIRST_USER_BOOTSTRAP_LOCK_MAX_RENEW_MS = 120_000;

export class BootstrapLockContentionError extends Error {
  readonly code = 'BOOTSTRAP_LOCK_CONTENTION';

  constructor() {
    super('Registration is temporarily busy because another signup is in progress. Please try again in a moment.');
    this.name = 'BootstrapLockContentionError';
  }
}

export class BootstrapLockLeaseLostError extends Error {
  readonly code = 'BOOTSTRAP_LOCK_LEASE_LOST';

  constructor() {
    super('Registration could not be completed safely. Please try again.');
    this.name = 'BootstrapLockLeaseLostError';
  }
}

type BootstrapDb = Pick<typeof db, 'select'>;

type PendingBootstrapLock = {
  token: string;
  renewal: LockRenewalHandle;
  leaseLost: boolean;
};

/**
 * In-memory map from signup correlation key to the held Redis lock state.
 * Released from Better Auth user.create.after; TTL is the safety net when INSERT fails.
 */
const pendingBootstrapLocks = new Map<string, PendingBootstrapLock>();

function normalizeCorrelationKey(correlationKey: string): string {
  return correlationKey.trim().toLowerCase();
}

async function countExistingUsers(database: BootstrapDb): Promise<number> {
  const [row] = await database.select({ value: count() }).from(schema.user);
  return Number(row?.value ?? 0);
}

async function failBootstrapLease(lockKey: string, token: string, renewal: LockRenewalHandle): Promise<never> {
  renewal.stop();
  await releaseLock(lockKey, token);
  throw new BootstrapLockLeaseLostError();
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
 * across API instances. The lock is acquired here, renewed until after-hook release, with TTL
 * as fallback when release or renewal stop fails.
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
    throw new BootstrapLockContentionError();
  }

  let leaseLost = false;
  const renewal = startLockRenewal(FIRST_USER_BOOTSTRAP_LOCK_KEY, token, FIRST_USER_BOOTSTRAP_LOCK_TTL_SECONDS, {
    renewIntervalMs: FIRST_USER_BOOTSTRAP_LOCK_RENEW_INTERVAL_MS,
    maxDurationMs: FIRST_USER_BOOTSTRAP_LOCK_MAX_RENEW_MS,
    onLeaseLost: () => {
      leaseLost = true;
      const pending = pendingBootstrapLocks.get(key);
      if (pending) {
        pending.leaseLost = true;
      }
    },
  });

  try {
    const role = bootstrapRoleForNewUser(await countExistingUsers(database));

    if (leaseLost || !(await isLockHeldByToken(FIRST_USER_BOOTSTRAP_LOCK_KEY, token))) {
      await failBootstrapLease(FIRST_USER_BOOTSTRAP_LOCK_KEY, token, renewal);
    }

    pendingBootstrapLocks.set(key, { token, renewal, leaseLost: false });
    return role;
  } catch (error) {
    if (error instanceof BootstrapLockLeaseLostError) {
      throw error;
    }

    renewal.stop();
    await releaseLock(FIRST_USER_BOOTSTRAP_LOCK_KEY, token);
    throw error;
  }
}

/** Returns true when renewal failed while the signup lock was still pending. */
export function consumeBootstrapLeaseLost(correlationKey: string): boolean {
  const key = normalizeCorrelationKey(correlationKey);
  const pending = pendingBootstrapLocks.get(key);
  return pending?.leaseLost ?? false;
}

/** Release the bootstrap lock after Better Auth finishes inserting the user row. */
export async function releaseBootstrapUserCreation(correlationKey: string): Promise<void> {
  const key = normalizeCorrelationKey(correlationKey);
  const pending = pendingBootstrapLocks.get(key);
  if (!pending) {
    return;
  }

  pending.renewal.stop();
  pendingBootstrapLocks.delete(key);
  await releaseLock(FIRST_USER_BOOTSTRAP_LOCK_KEY, pending.token);
}
