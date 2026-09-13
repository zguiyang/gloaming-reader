import { AsyncLocalStorage } from 'node:async_hooks';

import { count, sql } from 'drizzle-orm';

import * as schema from '@gloaming/db/schema';
import { type AuthRole, bootstrapRoleForNewUser } from '@gloaming/shared/auth';

import type { db } from '@/db';

/** Stable PostgreSQL advisory lock key for first-user bootstrap serialization. */
export const FIRST_USER_BOOTSTRAP_ADVISORY_LOCK_KEY = 1_847_593_021;

type AuthDatabase = typeof db;
type BootstrapDb = Pick<AuthDatabase, 'execute' | 'select'>;

export const authTransactionStorage = new AsyncLocalStorage<BootstrapDb>();

export class BootstrapTransactionRequiredError extends Error {
  readonly code = 'BOOTSTRAP_TRANSACTION_REQUIRED';

  constructor() {
    super('First-user bootstrap role assignment requires an active database transaction.');
    this.name = 'BootstrapTransactionRequiredError';
  }
}

/**
 * Wrap the Drizzle database passed to Better Auth so signup transactions expose the
 * active Drizzle transaction to bootstrap hooks via {@link authTransactionStorage}.
 */
export function bindAuthDatabaseForAdapter(database: AuthDatabase): AuthDatabase {
  const boundTransaction = <T>(fn: (tx: BootstrapDb) => Promise<T>): Promise<T> => {
    return database.transaction((tx) => authTransactionStorage.run(tx, () => fn(tx)));
  };

  return new Proxy(database, {
    get(target, prop, receiver) {
      if (prop === 'transaction') {
        return boundTransaction;
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

async function countExistingUsers(database: BootstrapDb): Promise<number> {
  const [row] = await database.select({ value: count() }).from(schema.user);
  return Number(row?.value ?? 0);
}

/**
 * Decide the bootstrap role for a new user inside Better Auth's signup transaction.
 *
 * Better Auth lifecycle (better-auth@1.6.26):
 * - `/sign-up/email` wraps the handler in `runWithTransaction` (api/routes/sign-up.mjs).
 * - `databaseHooks.user.create.before` runs before the adapter INSERT (db/with-hooks.mjs).
 * - The Drizzle adapter must set `transaction: true` so INSERT uses the same connection.
 *
 * Guarantee boundary: `pg_advisory_xact_lock`, user count, and Better Auth user INSERT
 * share one PostgreSQL transaction and release the lock on commit/rollback.
 */
export async function resolveBootstrapRoleForNewUser(
  database: BootstrapDb = getBootstrapDatabase(),
): Promise<AuthRole> {
  await database.execute(sql`select pg_advisory_xact_lock(${FIRST_USER_BOOTSTRAP_ADVISORY_LOCK_KEY})`);
  return bootstrapRoleForNewUser(await countExistingUsers(database));
}

function getBootstrapDatabase(): BootstrapDb {
  const transaction = authTransactionStorage.getStore();
  if (!transaction) {
    throw new BootstrapTransactionRequiredError();
  }
  return transaction;
}
