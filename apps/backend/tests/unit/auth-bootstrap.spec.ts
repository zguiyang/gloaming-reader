import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_ADMIN_ROLE, AUTH_USER_ROLE } from '@gloaming/shared/auth';

import {
  authTransactionStorage,
  bindAuthDatabaseForAdapter,
  BootstrapTransactionRequiredError,
  FIRST_USER_BOOTSTRAP_ADVISORY_LOCK_KEY,
  resolveBootstrapRoleForNewUser,
} from '@/lib/auth-bootstrap';

function createMockTx(existingUserCount: number) {
  const from = vi.fn().mockResolvedValue([{ value: existingUserCount }]);
  const select = vi.fn().mockReturnValue({ from });
  const execute = vi.fn().mockResolvedValue(undefined);
  return { select, from, execute };
}

describe('resolveBootstrapRoleForNewUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('acquires a transaction advisory lock before counting users', async () => {
    const tx = createMockTx(0);

    await authTransactionStorage.run(tx as never, () => resolveBootstrapRoleForNewUser(tx));

    expect(tx.execute).toHaveBeenCalledWith(
      sql`select pg_advisory_xact_lock(${FIRST_USER_BOOTSTRAP_ADVISORY_LOCK_KEY})`,
    );
    expect(tx.select).toHaveBeenCalledOnce();
    expect(tx.from).toHaveBeenCalledOnce();
  });

  it('returns admin only when the user table is empty', async () => {
    await expect(
      authTransactionStorage.run(createMockTx(0) as never, () => resolveBootstrapRoleForNewUser()),
    ).resolves.toBe(AUTH_ADMIN_ROLE);
    await expect(
      authTransactionStorage.run(createMockTx(1) as never, () => resolveBootstrapRoleForNewUser()),
    ).resolves.toBe(AUTH_USER_ROLE);
    await expect(
      authTransactionStorage.run(createMockTx(12) as never, () => resolveBootstrapRoleForNewUser()),
    ).resolves.toBe(AUTH_USER_ROLE);
  });

  it('rejects bootstrap when no auth transaction is active', async () => {
    await expect(resolveBootstrapRoleForNewUser()).rejects.toBeInstanceOf(BootstrapTransactionRequiredError);
  });

  it('rejects bootstrap when counting fails inside the transaction', async () => {
    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockRejectedValue(new Error('db unavailable')),
      }),
    };

    await expect(authTransactionStorage.run(tx as never, () => resolveBootstrapRoleForNewUser(tx))).rejects.toThrow(
      'db unavailable',
    );
  });
});

describe('bindAuthDatabaseForAdapter', () => {
  it('exposes the active drizzle transaction to bootstrap hooks', async () => {
    const tx = createMockTx(0);
    const transaction = vi.fn(async (fn: (innerTx: typeof tx) => Promise<unknown>) => fn(tx));
    const database = bindAuthDatabaseForAdapter({ transaction } as never);

    await database.transaction(async (innerTx) => {
      expect(innerTx).toBe(tx);
      await expect(resolveBootstrapRoleForNewUser(innerTx)).resolves.toBe(AUTH_ADMIN_ROLE);
    });

    expect(transaction).toHaveBeenCalledOnce();
    expect(tx.execute).toHaveBeenCalledOnce();
  });
});
