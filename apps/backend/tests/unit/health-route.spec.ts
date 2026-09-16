import { describe, expect, it, vi } from 'vitest';

const checkReadiness = vi.hoisted(() => vi.fn());

vi.mock('@/lib/health', () => ({ checkReadiness }));

describe('health endpoints', () => {
  it('keeps liveness independent of dependency state', async () => {
    const { routes } = await import('@/routes');

    const response = await routes.request('/api/health/live');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'live' });
    expect(checkReadiness).not.toHaveBeenCalled();
  });

  it.each([
    [{ ready: true, dependencies: { postgres: 'up', redis: 'up' } }, 200, 'ready'],
    [{ ready: false, dependencies: { postgres: 'down', redis: 'up' } }, 503, 'not_ready'],
    [{ ready: false, dependencies: { postgres: 'up', redis: 'down' } }, 503, 'not_ready'],
  ])('reports readiness only when both dependencies are up', async (result, status, state) => {
    checkReadiness.mockResolvedValueOnce(result);
    const { routes } = await import('@/routes');

    const response = await routes.request('/api/health/ready');

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ status: state, dependencies: result.dependencies });
  });
});
