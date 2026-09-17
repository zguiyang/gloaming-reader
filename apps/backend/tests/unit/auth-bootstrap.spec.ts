import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_ADMIN_ROLE, AUTH_USER_ROLE } from '@gloaming/shared/auth';

import {
  ADMIN_BOOTSTRAP_ADVISORY_LOCK_KEY,
  AdminBootstrapAlreadyExistsError,
  AdminBootstrapTransactionRequiredError,
  authTransactionStorage,
  bindAuthDatabaseForAdapter,
  resolveRoleForNewUser,
  withAdminBootstrap,
} from '@/lib/auth-bootstrap';

function createMockTx(existingAdminCount: number) {
  const where = vi.fn().mockResolvedValue([{ value: existingAdminCount }]);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  const execute = vi.fn().mockResolvedValue(undefined);
  return { select, from, execute };
}

describe('resolveRoleForNewUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assigns user to public signups without touching the database', async () => {
    const tx = createMockTx(0);

    await authTransactionStorage.run(tx as never, () => resolveRoleForNewUser(tx));

    await expect(resolveRoleForNewUser()).resolves.toBe(AUTH_USER_ROLE);
    expect(tx.execute).not.toHaveBeenCalled();
    expect(tx.select).not.toHaveBeenCalled();
  });

  it('assigns admin only inside the explicit admin bootstrap context', async () => {
    const tx = createMockTx(0);

    await expect(
      authTransactionStorage.run(tx as never, () => withAdminBootstrap(() => resolveRoleForNewUser())),
    ).resolves.toBe(AUTH_ADMIN_ROLE);

    expect(tx.execute).toHaveBeenCalledWith(sql`select pg_advisory_xact_lock(${ADMIN_BOOTSTRAP_ADVISORY_LOCK_KEY})`);
    expect(tx.select).toHaveBeenCalledOnce();
    expect(tx.from).toHaveBeenCalledOnce();
  });

  it('rejects explicit admin bootstrap when no auth transaction is active', async () => {
    await expect(withAdminBootstrap(() => resolveRoleForNewUser())).rejects.toBeInstanceOf(
      AdminBootstrapTransactionRequiredError,
    );
  });

  it('rejects explicit admin bootstrap when an administrator already exists', async () => {
    const tx = createMockTx(1);

    await expect(
      authTransactionStorage.run(tx as never, () => withAdminBootstrap(() => resolveRoleForNewUser())),
    ).rejects.toBeInstanceOf(AdminBootstrapAlreadyExistsError);
  });

  it('propagates admin count failures inside the transaction', async () => {
    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue(new Error('db unavailable')),
        }),
      }),
    };

    await expect(
      authTransactionStorage.run(tx as never, () => withAdminBootstrap(() => resolveRoleForNewUser(tx))),
    ).rejects.toThrow('db unavailable');
  });
});

describe('bindAuthDatabaseForAdapter', () => {
  it('exposes the active drizzle transaction to bootstrap hooks', async () => {
    const tx = createMockTx(0);
    const transaction = vi.fn(async (fn: (innerTx: typeof tx) => Promise<unknown>) => fn(tx));
    const database = bindAuthDatabaseForAdapter({ transaction } as never);

    await database.transaction(async (innerTx) => {
      expect(innerTx).toBe(tx);
      await expect(withAdminBootstrap(() => resolveRoleForNewUser(innerTx))).resolves.toBe(AUTH_ADMIN_ROLE);
    });

    expect(transaction).toHaveBeenCalledOnce();
    expect(tx.execute).toHaveBeenCalledOnce();
  });
});
