import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbPing: vi.fn(),
  redisPing: vi.fn(),
}));

vi.mock('@/db', () => ({ dbPing: mocks.dbPing }));
vi.mock('@/lib/redis', () => ({ redisPing: mocks.redisPing }));

import { checkReadiness } from '@/lib/health';

describe('readiness dependency checks', () => {
  it.each([
    [undefined, undefined, true, { postgres: 'up', redis: 'up' }],
    [new Error('db down'), undefined, false, { postgres: 'down', redis: 'up' }],
    [undefined, new Error('redis down'), false, { postgres: 'up', redis: 'down' }],
    [new Error('db down'), new Error('redis down'), false, { postgres: 'down', redis: 'down' }],
  ])('maps dependency results to a bounded readiness response', async (dbError, redisError, ready, dependencies) => {
    mocks.dbPing.mockReset();
    mocks.redisPing.mockReset();
    if (dbError) mocks.dbPing.mockRejectedValueOnce(dbError);
    else mocks.dbPing.mockResolvedValueOnce(undefined);
    if (redisError) mocks.redisPing.mockRejectedValueOnce(redisError);
    else mocks.redisPing.mockResolvedValueOnce('PONG');

    await expect(checkReadiness()).resolves.toEqual({ ready, dependencies });
  });
});
