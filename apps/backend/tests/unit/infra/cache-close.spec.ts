import { afterEach, describe, expect, it, vi } from 'vitest';

describe('closeRedis', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('ioredis');
  });

  it('is a no-op when the shared client was never created', async () => {
    const { closeRedis } = await import('@/infra/cache');
    await expect(closeRedis()).resolves.toBeUndefined();
  });

  it('quits the client and allows a subsequent no-op close', async () => {
    const quit = vi.fn().mockResolvedValue('OK');
    const disconnect = vi.fn();

    vi.doMock('ioredis', () => ({
      Redis: class {
        on() {
          return this;
        }
        quit = quit;
        disconnect = disconnect;
      },
    }));

    const cache = await import('@/infra/cache');
    cache.getRedis();
    await cache.closeRedis();
    expect(quit).toHaveBeenCalledTimes(1);

    await cache.closeRedis();
    expect(quit).toHaveBeenCalledTimes(1);
  });
});
