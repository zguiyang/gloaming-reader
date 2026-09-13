import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_ADMIN_ROLE, AUTH_USER_ROLE } from '@gloaming/shared/auth';

import { FIRST_USER_BOOTSTRAP_LOCK_KEY, resolveBootstrapRoleForNewUser } from '@/lib/auth-bootstrap';

function createMockDb(existingUserCount: number) {
  const execute = vi.fn().mockResolvedValue(undefined);
  const from = vi.fn().mockResolvedValue([{ value: existingUserCount }]);
  const select = vi.fn().mockReturnValue({ from });
  return { execute, select, from };
}

describe('resolveBootstrapRoleForNewUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('acquires the bootstrap advisory lock before counting users', async () => {
    const database = createMockDb(0);
    await resolveBootstrapRoleForNewUser(database);
    expect(database.execute).toHaveBeenCalledOnce();
    expect(database.select).toHaveBeenCalledOnce();
    expect(database.from).toHaveBeenCalledOnce();
  });

  it('returns admin only when the user table is empty', async () => {
    await expect(resolveBootstrapRoleForNewUser(createMockDb(0))).resolves.toBe(AUTH_ADMIN_ROLE);
    await expect(resolveBootstrapRoleForNewUser(createMockDb(1))).resolves.toBe(AUTH_USER_ROLE);
    await expect(resolveBootstrapRoleForNewUser(createMockDb(12))).resolves.toBe(AUTH_USER_ROLE);
  });

  it('uses the stable bootstrap lock key', () => {
    expect(FIRST_USER_BOOTSTRAP_LOCK_KEY).toBe(7_901_001);
  });
});
