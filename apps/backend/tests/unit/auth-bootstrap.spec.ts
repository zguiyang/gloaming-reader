import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_ADMIN_ROLE, AUTH_USER_ROLE } from '@gloaming/shared/auth';

import {
  FIRST_USER_BOOTSTRAP_LOCK_KEY,
  FIRST_USER_BOOTSTRAP_LOCK_MAX_WAIT_MS,
  FIRST_USER_BOOTSTRAP_LOCK_TTL_SECONDS,
  releaseBootstrapUserCreation,
  resolveBootstrapRoleForNewUser,
} from '@/lib/auth-bootstrap';

const redisMocks = vi.hoisted(() => ({
  acquireLockWithWait: vi.fn(),
  releaseLock: vi.fn(),
}));

vi.mock('@/lib/redis-lock', () => ({
  acquireLockWithWait: redisMocks.acquireLockWithWait,
  releaseLock: redisMocks.releaseLock,
}));

function createMockDb(existingUserCount: number) {
  const from = vi.fn().mockResolvedValue([{ value: existingUserCount }]);
  const select = vi.fn().mockReturnValue({ from });
  return { select, from };
}

describe('resolveBootstrapRoleForNewUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisMocks.acquireLockWithWait.mockResolvedValue(true);
    redisMocks.releaseLock.mockResolvedValue(undefined);
  });

  it('acquires the Redis bootstrap lock before counting users', async () => {
    const database = createMockDb(0);
    await resolveBootstrapRoleForNewUser('user@example.com', database);

    expect(redisMocks.acquireLockWithWait).toHaveBeenCalledWith(
      FIRST_USER_BOOTSTRAP_LOCK_KEY,
      expect.any(String),
      FIRST_USER_BOOTSTRAP_LOCK_TTL_SECONDS,
      { maxWaitMs: FIRST_USER_BOOTSTRAP_LOCK_MAX_WAIT_MS },
    );
    expect(database.select).toHaveBeenCalledOnce();
    expect(database.from).toHaveBeenCalledOnce();
  });

  it('returns admin only when the user table is empty', async () => {
    await expect(resolveBootstrapRoleForNewUser('first@example.com', createMockDb(0))).resolves.toBe(AUTH_ADMIN_ROLE);
    await expect(resolveBootstrapRoleForNewUser('second@example.com', createMockDb(1))).resolves.toBe(AUTH_USER_ROLE);
    await expect(resolveBootstrapRoleForNewUser('third@example.com', createMockDb(12))).resolves.toBe(AUTH_USER_ROLE);
  });

  it('fails closed to regular user when the lock cannot be acquired in time', async () => {
    redisMocks.acquireLockWithWait.mockResolvedValue(false);
    await expect(resolveBootstrapRoleForNewUser('late@example.com', createMockDb(0))).resolves.toBe(AUTH_USER_ROLE);
    expect(redisMocks.releaseLock).not.toHaveBeenCalled();
  });

  it('releases the lock when counting fails before INSERT', async () => {
    const database = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockRejectedValue(new Error('db unavailable')),
      }),
    };

    await expect(resolveBootstrapRoleForNewUser('broken@example.com', database)).rejects.toThrow('db unavailable');
    expect(redisMocks.releaseLock).toHaveBeenCalledWith(FIRST_USER_BOOTSTRAP_LOCK_KEY, expect.any(String));
  });
});

describe('releaseBootstrapUserCreation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisMocks.acquireLockWithWait.mockResolvedValue(true);
    redisMocks.releaseLock.mockResolvedValue(undefined);
  });

  it('releases the held bootstrap lock after user INSERT completes', async () => {
    await resolveBootstrapRoleForNewUser('done@example.com', createMockDb(0));
    const token = redisMocks.acquireLockWithWait.mock.calls[0]?.[1] as string;

    await releaseBootstrapUserCreation('done@example.com');

    expect(redisMocks.releaseLock).toHaveBeenCalledWith(FIRST_USER_BOOTSTRAP_LOCK_KEY, token);
  });

  it('normalizes correlation keys before release', async () => {
    await resolveBootstrapRoleForNewUser('Mixed@Example.com', createMockDb(1));
    const token = redisMocks.acquireLockWithWait.mock.calls[0]?.[1] as string;

    await releaseBootstrapUserCreation('  mixed@example.com  ');

    expect(redisMocks.releaseLock).toHaveBeenCalledWith(FIRST_USER_BOOTSTRAP_LOCK_KEY, token);
  });
});
