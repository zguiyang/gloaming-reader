import { AsyncLocalStorage } from 'node:async_hooks';

import { count, eq, sql } from 'drizzle-orm';

import * as schema from '@gloaming/db/schema';
import { AUTH_ADMIN_ROLE, AUTH_USER_ROLE, type AuthRole } from '@gloaming/shared/auth';

import type { db } from '@/db';

/** Stable PostgreSQL advisory lock key for administrator bootstrap serialization. */
export const ADMIN_BOOTSTRAP_ADVISORY_LOCK_KEY = 1_847_593_021;

type AuthDatabase = typeof db;
type BootstrapDb = Pick<AuthDatabase, 'execute' | 'select'>;

export const authTransactionStorage = new AsyncLocalStorage<BootstrapDb>();
const adminBootstrapStorage = new AsyncLocalStorage<true>();

export class AdminBootstrapTransactionRequiredError extends Error {
  readonly code = 'ADMIN_BOOTSTRAP_TRANSACTION_REQUIRED';

  constructor() {
    super('Administrator bootstrap role assignment requires an active database transaction.');
    this.name = 'AdminBootstrapTransactionRequiredError';
  }
}

export class AdminBootstrapAlreadyExistsError extends Error {
  readonly code = 'ADMIN_BOOTSTRAP_ALREADY_EXISTS';

  constructor() {
    super('Refusing administrator bootstrap: an administrator already exists.');
    this.name = 'AdminBootstrapAlreadyExistsError';
  }
}

/** Mark one trusted create:admin call as allowed to create an administrator. */
export function withAdminBootstrap<T>(fn: () => Promise<T>): Promise<T> {
  return adminBootstrapStorage.run(true, fn);
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

async function countExistingAdmins(database: BootstrapDb): Promise<number> {
  const [row] = await database
    .select({ value: count() })
    .from(schema.user)
    .where(eq(schema.user.role, AUTH_ADMIN_ROLE));
  return Number(row?.value ?? 0);
}

/**
 * Decide the role for a new user inside Better Auth's signup transaction.
 *
 * Better Auth lifecycle (better-auth@1.6.26):
 * - `/sign-up/email` wraps the handler in `runWithTransaction` (api/routes/sign-up.mjs).
 * - `databaseHooks.user.create.before` runs before the adapter INSERT (db/with-hooks.mjs).
 * - The Drizzle adapter must set `transaction: true` so INSERT uses the same connection.
 *
 * Public signups always receive `user`. Only the trusted `create:admin` command
 * enters the admin bootstrap context; its advisory lock, admin count, and user
 * INSERT share one PostgreSQL transaction.
 */
export async function resolveRoleForNewUser(database?: BootstrapDb): Promise<AuthRole> {
  if (adminBootstrapStorage.getStore() !== true) {
    return AUTH_USER_ROLE;
  }

  const bootstrapDatabase = database ?? getBootstrapDatabase();
  await bootstrapDatabase.execute(sql`select pg_advisory_xact_lock(${ADMIN_BOOTSTRAP_ADVISORY_LOCK_KEY})`);
  if ((await countExistingAdmins(bootstrapDatabase)) > 0) {
    throw new AdminBootstrapAlreadyExistsError();
  }
  return AUTH_ADMIN_ROLE;
}

function getBootstrapDatabase(): BootstrapDb {
  const transaction = authTransactionStorage.getStore();
  if (!transaction) {
    throw new AdminBootstrapTransactionRequiredError();
  }
  return transaction;
}
