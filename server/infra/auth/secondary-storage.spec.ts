import { beforeEach, describe, expect, it, vi } from 'vitest';

const set = vi.fn(async () => 'OK');
const get = vi.fn(async () => null);
const del = vi.fn(async () => 1);
const evalRedis = vi.fn(async () => 1);

vi.mock('@/server/infra/cache', () => ({
  getRedis: () => ({ set, get, del, eval: evalRedis }),
}));

vi.mock('@/server/infra/logging/logger', () => ({
  authLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { authLogger } from '@/server/infra/logging/logger';

import {
  AUTH_SECONDARY_STORAGE_DEFAULT_TTL_SECONDS,
  AUTH_SECONDARY_STORAGE_MAX_TTL_SECONDS,
  authSecondaryStorage,
  resolveAuthSecondaryStorageTtl,
} from '@/server/infra/auth/secondary-storage';

describe('resolveAuthSecondaryStorageTtl', () => {
  it('defaults when ttl is missing or non-positive', () => {
    expect(resolveAuthSecondaryStorageTtl()).toBe(AUTH_SECONDARY_STORAGE_DEFAULT_TTL_SECONDS);
    expect(resolveAuthSecondaryStorageTtl(0)).toBe(AUTH_SECONDARY_STORAGE_DEFAULT_TTL_SECONDS);
    expect(resolveAuthSecondaryStorageTtl(-1)).toBe(AUTH_SECONDARY_STORAGE_DEFAULT_TTL_SECONDS);
    expect(resolveAuthSecondaryStorageTtl(Number.NaN)).toBe(AUTH_SECONDARY_STORAGE_DEFAULT_TTL_SECONDS);
  });

  it('clamps values above the max', () => {
    expect(resolveAuthSecondaryStorageTtl(AUTH_SECONDARY_STORAGE_MAX_TTL_SECONDS + 1)).toBe(
      AUTH_SECONDARY_STORAGE_MAX_TTL_SECONDS,
    );
  });

  it('keeps valid positive TTLs at or below the max', () => {
    expect(resolveAuthSecondaryStorageTtl(60)).toBe(60);
    expect(resolveAuthSecondaryStorageTtl(AUTH_SECONDARY_STORAGE_MAX_TTL_SECONDS)).toBe(
      AUTH_SECONDARY_STORAGE_MAX_TTL_SECONDS,
    );
  });
});

describe('authSecondaryStorage.set', () => {
  beforeEach(() => {
    set.mockClear();
    vi.mocked(authLogger.warn).mockClear();
  });

  it('always writes with EX and never omits expiry', async () => {
    await authSecondaryStorage.set('session-token', '{"ok":true}', 120);
    expect(set).toHaveBeenCalledWith('better-auth:session-token', '{"ok":true}', 'EX', 120);
  });

  it('applies the default TTL when Better Auth omits ttl', async () => {
    await authSecondaryStorage.set('session-token', '{"ok":true}');
    expect(set).toHaveBeenCalledWith(
      'better-auth:session-token',
      '{"ok":true}',
      'EX',
      AUTH_SECONDARY_STORAGE_DEFAULT_TTL_SECONDS,
    );
    expect(authLogger.warn).toHaveBeenCalled();
  });

  it('clamps oversized TTL to the max', async () => {
    await authSecondaryStorage.set('session-token', '{"ok":true}', AUTH_SECONDARY_STORAGE_MAX_TTL_SECONDS * 2);
    expect(set).toHaveBeenCalledWith(
      'better-auth:session-token',
      '{"ok":true}',
      'EX',
      AUTH_SECONDARY_STORAGE_MAX_TTL_SECONDS,
    );
  });
});
