import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthSessionUser } from '@/lib/auth/auth';
import { aiRateLimit } from '@/middleware/rate-limit';

type FakeRedis = {
  concurrent: Map<string, number>;
  eval: ReturnType<typeof vi.fn>;
};

const { redis } = vi.hoisted(() => {
  const concurrent = new Map<string, number>();
  const evalFn = vi.fn(async (script: string, _keys: number, key: string, limit?: string) => {
    const current = concurrent.get(key) ?? 0;
    if (script.includes('current >=') && current >= Number(limit)) {
      return 0;
    }
    if (script.includes('local next')) {
      const next = current + 1;
      concurrent.set(key, next);
      return next;
    }
    if (current <= 1) {
      concurrent.delete(key);
      return 1;
    }
    const next = current - 1;
    concurrent.set(key, next);
    return next;
  });
  return { redis: { concurrent, eval: evalFn } as FakeRedis };
});

vi.mock('@/lib/redis', () => ({
  getRedis: () => redis,
}));

vi.mock('rate-limiter-flexible', async () => {
  class MockRateLimiterRes {
    msBeforeNext: number;
    remainingPoints: number;

    constructor(msBeforeNext: number, remainingPoints: number) {
      this.msBeforeNext = msBeforeNext;
      this.remainingPoints = remainingPoints;
    }
  }

  class MockRateLimiterRedis {
    private readonly hits = new Map<string, number>();
    private readonly points: number;
    private readonly duration: number;

    constructor(options: { points: number; duration: number }) {
      this.points = options.points;
      this.duration = options.duration;
    }

    async consume(key: string) {
      const next = (this.hits.get(key) ?? 0) + 1;
      this.hits.set(key, next);
      if (next > this.points) {
        throw new MockRateLimiterRes(this.duration * 1000, 0);
      }
      return new MockRateLimiterRes(0, this.points - next);
    }
  }

  class MockRateLimiterMemory extends MockRateLimiterRedis {}

  return {
    RateLimiterMemory: MockRateLimiterMemory,
    RateLimiterRedis: MockRateLimiterRedis,
    RateLimiterRes: MockRateLimiterRes,
  };
});

let userSequence = 0;

function createTestApp(options?: {
  fail?: boolean;
  streamError?: boolean;
  gate?: Promise<void>;
  started?: () => void;
  translateGate?: Promise<void>;
  translateStarted?: () => void;
  userId?: string | ((request: Request) => string);
}) {
  const configuredUserId = options?.userId;
  const fallbackUserId = configuredUserId ?? `rate-limit-user-${++userSequence}`;
  const app = new Hono<{ Variables: { user: AuthSessionUser } }>();
  app.use('*', async (c, next) => {
    const userId = typeof configuredUserId === 'function' ? configuredUserId(c.req.raw) : fallbackUserId;
    c.set('user', { id: userId } as AuthSessionUser);
    return next();
  });
  app.post('/assist', aiRateLimit('assist'), async () => {
    options?.started?.();
    await options?.gate;
    if (options?.fail) {
      throw new Error('test failure');
    }
    if (options?.streamError) {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('stream failure'));
          },
        }),
      );
    }
    return new Response('ok');
  });
  app.post('/translate', aiRateLimit('translate'), async () => {
    options?.translateStarted?.();
    await options?.translateGate;
    return new Response('ok');
  });
  app.onError(() => new Response('error', { status: 500 }));
  return app;
}

describe('authenticated AI rate limits', () => {
  afterEach(() => {
    redis.concurrent.clear();
  });

  it('allows normal Assist traffic and returns 429 after the user frequency limit', async () => {
    const app = createTestApp();
    for (let index = 0; index < 10; index += 1) {
      const response = await app.request('/assist', { method: 'POST' });
      expect(response.status).toBe(200);
      await response.text();
    }
    const limited = await app.request('/assist', { method: 'POST' });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBeTruthy();
  });

  it('limits active Assist streams and releases the slot on success', async () => {
    let release!: () => void;
    let started = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = createTestApp({
      gate,
      started: () => {
        started += 1;
      },
    });
    const first = app.request('/assist', { method: 'POST' });
    const second = app.request('/assist', { method: 'POST' });
    const third = app.request('/assist', { method: 'POST' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toBe(2);
    expect((await third).status).toBe(429);
    release();
    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    await Promise.all([firstResponse.text(), secondResponse.text()]);

    const followUp = await app.request('/assist', { method: 'POST' });
    expect(followUp.status).toBe(200);
    await followUp.text();
  });

  it('enforces the Assist IP frequency limit across users', async () => {
    const app = createTestApp({
      userId: (request) => request.headers.get('x-test-user') ?? 'rate-limit-ip-user',
    });
    const headersFor = (index: number) => ({
      'x-real-ip': '198.51.100.10',
      'x-test-user': `rate-limit-ip-user-${index}`,
    });

    for (let index = 0; index < 60; index += 1) {
      const response = await app.request('/assist', {
        method: 'POST',
        headers: headersFor(index),
      });
      expect(response.status).toBe(200);
      await response.text();
    }

    const limited = await app.request('/assist', {
      method: 'POST',
      headers: headersFor(60),
    });
    expect(limited.status).toBe(429);
  });

  it('releases the active Assist slot when the handler fails', async () => {
    const userId = 'rate-limit-failing-user';
    const failing = createTestApp({ fail: true, userId });
    expect((await failing.request('/assist', { method: 'POST' })).status).toBe(500);

    const succeeding = createTestApp({ userId });
    const response = await succeeding.request('/assist', { method: 'POST' });
    expect(response.status).toBe(200);
    await response.text();
  });

  it('releases the active Assist slot when the consumer cancels the stream', async () => {
    const userId = 'rate-limit-cancelled-user';
    const app = createTestApp({ userId });
    const response = await app.request('/assist', { method: 'POST' });
    expect(response.status).toBe(200);
    await response.body?.cancel('test cancellation');

    const followUp = await app.request('/assist', { method: 'POST' });
    expect(followUp.status).toBe(200);
    await followUp.text();
  });

  it('releases the active Assist slot when reading the stream fails', async () => {
    const userId = 'rate-limit-stream-error-user';
    const failing = createTestApp({ streamError: true, userId });
    const response = await failing.request('/assist', { method: 'POST' });
    expect(response.status).toBe(200);
    await expect(response.text()).rejects.toThrow('stream failure');

    const succeeding = createTestApp({ userId });
    const followUp = await succeeding.request('/assist', { method: 'POST' });
    expect(followUp.status).toBe(200);
    await followUp.text();
  });

  it('applies the same frequency protection to Translation', async () => {
    const app = createTestApp();
    for (let index = 0; index < 20; index += 1) {
      const response = await app.request('/translate', { method: 'POST' });
      expect(response.status).toBe(200);
      await response.text();
    }
    expect((await app.request('/translate', { method: 'POST' })).status).toBe(429);
  });

  it('limits active Translation streams and releases the slot on success', async () => {
    let release!: () => void;
    let started = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = createTestApp({
      translateGate: gate,
      translateStarted: () => {
        started += 1;
      },
    });
    const requests = [
      app.request('/translate', { method: 'POST' }),
      app.request('/translate', { method: 'POST' }),
      app.request('/translate', { method: 'POST' }),
      app.request('/translate', { method: 'POST' }),
    ];
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toBe(3);
    expect((await requests[3]).status).toBe(429);
    release();
    const responses = await Promise.all(requests.slice(0, 3));
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    await Promise.all(responses.map((response) => response.text()));

    const followUp = await app.request('/translate', { method: 'POST' });
    expect(followUp.status).toBe(200);
    await followUp.text();
  });

  it('enforces the Translation IP frequency limit across users', async () => {
    const app = createTestApp({
      userId: (request) => request.headers.get('x-test-user') ?? 'rate-limit-translation-ip-user',
    });
    const headersFor = (index: number) => ({
      'x-real-ip': '198.51.100.11',
      'x-test-user': `rate-limit-translation-ip-user-${index}`,
    });

    for (let index = 0; index < 120; index += 1) {
      const response = await app.request('/translate', {
        method: 'POST',
        headers: headersFor(index),
      });
      expect(response.status).toBe(200);
      await response.text();
    }

    const limited = await app.request('/translate', {
      method: 'POST',
      headers: headersFor(120),
    });
    expect(limited.status).toBe(429);
  });
});
