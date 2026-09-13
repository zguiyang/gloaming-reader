import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_ADMIN_ROLE, AUTH_USER_ROLE } from '@gloaming/shared/auth';

import {
  BootstrapLockContentionError,
  BootstrapLockLeaseLostError,
  consumeBootstrapLeaseLost,
  FIRST_USER_BOOTSTRAP_LOCK_KEY,
  FIRST_USER_BOOTSTRAP_LOCK_MAX_RENEW_MS,
  FIRST_USER_BOOTSTRAP_LOCK_MAX_WAIT_MS,
  FIRST_USER_BOOTSTRAP_LOCK_RENEW_INTERVAL_MS,
  FIRST_USER_BOOTSTRAP_LOCK_TTL_SECONDS,
  releaseBootstrapUserCreation,
  resolveBootstrapRoleForNewUser,
} from '@/lib/auth-bootstrap';

const redisMocks = vi.hoisted(() => ({
  acquireLockWithWait: vi.fn(),
  isLockHeldByToken: vi.fn(),
  releaseLock: vi.fn(),
  startLockRenewal: vi.fn(),
}));

vi.mock('@/lib/redis-lock', () => ({
  acquireLockWithWait: redisMocks.acquireLockWithWait,
  isLockHeldByToken: redisMocks.isLockHeldByToken,
  releaseLock: redisMocks.releaseLock,
  startLockRenewal: redisMocks.startLockRenewal,
}));

function createMockDb(existingUserCount: number) {
  const from = vi.fn().mockResolvedValue([{ value: existingUserCount }]);
  const select = vi.fn().mockReturnValue({ from });
  return { select, from };
}

function mockRenewal() {
  const stop = vi.fn();
  redisMocks.startLockRenewal.mockReturnValue({ stop });
  return stop;
}

describe('resolveBootstrapRoleForNewUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisMocks.acquireLockWithWait.mockResolvedValue(true);
    redisMocks.isLockHeldByToken.mockResolvedValue(true);
    redisMocks.releaseLock.mockResolvedValue(undefined);
    mockRenewal();
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
    expect(redisMocks.startLockRenewal).toHaveBeenCalledWith(
      FIRST_USER_BOOTSTRAP_LOCK_KEY,
      expect.any(String),
      FIRST_USER_BOOTSTRAP_LOCK_TTL_SECONDS,
      expect.objectContaining({
        renewIntervalMs: FIRST_USER_BOOTSTRAP_LOCK_RENEW_INTERVAL_MS,
        maxDurationMs: FIRST_USER_BOOTSTRAP_LOCK_MAX_RENEW_MS,
        onLeaseLost: expect.any(Function),
      }),
    );
    expect(database.select).toHaveBeenCalledOnce();
    expect(database.from).toHaveBeenCalledOnce();
  });

  it('returns admin only when the user table is empty', async () => {
    await expect(resolveBootstrapRoleForNewUser('first@example.com', createMockDb(0))).resolves.toBe(AUTH_ADMIN_ROLE);
    await expect(resolveBootstrapRoleForNewUser('second@example.com', createMockDb(1))).resolves.toBe(AUTH_USER_ROLE);
    await expect(resolveBootstrapRoleForNewUser('third@example.com', createMockDb(12))).resolves.toBe(AUTH_USER_ROLE);
  });

  it('rejects signup when the lock cannot be acquired in time', async () => {
    redisMocks.acquireLockWithWait.mockResolvedValue(false);
    await expect(resolveBootstrapRoleForNewUser('late@example.com', createMockDb(0))).rejects.toBeInstanceOf(
      BootstrapLockContentionError,
    );
    expect(redisMocks.startLockRenewal).not.toHaveBeenCalled();
    expect(redisMocks.releaseLock).not.toHaveBeenCalled();
  });

  it('rejects signup when the lock is lost before role assignment completes', async () => {
    redisMocks.isLockHeldByToken.mockResolvedValue(false);
    const stop = mockRenewal();

    await expect(resolveBootstrapRoleForNewUser('lost@example.com', createMockDb(0))).rejects.toBeInstanceOf(
      BootstrapLockLeaseLostError,
    );
    expect(stop).toHaveBeenCalledOnce();
    expect(redisMocks.releaseLock).toHaveBeenCalledWith(FIRST_USER_BOOTSTRAP_LOCK_KEY, expect.any(String));
  });

  it('marks pending signup when renewal fails after role assignment', async () => {
    let onLeaseLost: (() => void) | undefined;
    const stop = vi.fn();
    redisMocks.startLockRenewal.mockImplementation((_key, _token, _ttl, options) => {
      onLeaseLost = options?.onLeaseLost;
      return { stop };
    });

    await resolveBootstrapRoleForNewUser('pending@example.com', createMockDb(0));
    onLeaseLost?.('renewal_failed');

    expect(consumeBootstrapLeaseLost('pending@example.com')).toBe(true);
  });

  it('releases the lock when counting fails before INSERT', async () => {
    const database = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockRejectedValue(new Error('db unavailable')),
      }),
    };
    const stop = mockRenewal();

    await expect(resolveBootstrapRoleForNewUser('broken@example.com', database)).rejects.toThrow('db unavailable');
    expect(stop).toHaveBeenCalledOnce();
    expect(redisMocks.releaseLock).toHaveBeenCalledWith(FIRST_USER_BOOTSTRAP_LOCK_KEY, expect.any(String));
  });
});

describe('releaseBootstrapUserCreation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisMocks.acquireLockWithWait.mockResolvedValue(true);
    redisMocks.isLockHeldByToken.mockResolvedValue(true);
    redisMocks.releaseLock.mockResolvedValue(undefined);
    mockRenewal();
  });

  it('stops renewal before compare-and-delete release after user INSERT completes', async () => {
    const stop = mockRenewal();
    await resolveBootstrapRoleForNewUser('done@example.com', createMockDb(0));
    const token = redisMocks.acquireLockWithWait.mock.calls[0]?.[1] as string;

    await releaseBootstrapUserCreation('done@example.com');

    expect(stop).toHaveBeenCalledOnce();
    expect(redisMocks.releaseLock).toHaveBeenCalledWith(FIRST_USER_BOOTSTRAP_LOCK_KEY, token);
  });

  it('normalizes correlation keys before release', async () => {
    const stop = mockRenewal();
    await resolveBootstrapRoleForNewUser('Mixed@Example.com', createMockDb(1));
    const token = redisMocks.acquireLockWithWait.mock.calls[0]?.[1] as string;

    await releaseBootstrapUserCreation('  mixed@example.com  ');

    expect(stop).toHaveBeenCalledOnce();
    expect(redisMocks.releaseLock).toHaveBeenCalledWith(FIRST_USER_BOOTSTRAP_LOCK_KEY, token);
  });
});
