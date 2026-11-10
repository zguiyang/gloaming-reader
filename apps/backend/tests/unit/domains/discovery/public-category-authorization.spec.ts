import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { discoveryAdminRoutes } from '@/domains/discovery/routes/admin';
import type { AuthSession, AuthSessionUser } from '@/infra/auth/auth';
import { type AuthVariables, requireAdmin } from '@/infra/http/middleware/auth';
import { ERROR_CODES } from '@/shared/errors/codes';

const adminUser = { id: 'admin-1', role: 'admin' } as AuthSessionUser;
const regularUser = { id: 'user-1', role: 'user' } as AuthSessionUser;
const session = {} as AuthSession;

function withIdentity(user: AuthSessionUser | null, activeSession: AuthSession | null) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    c.set('session', activeSession);
    await next();
  });
  return app;
}

describe('requireAdmin authorization', () => {
  const probe = () => {
    const app = withIdentity(null, null);
    app.get('/probe', requireAdmin, (c) => c.json({ ok: true }));
    return app;
  };

  it('rejects anonymous callers with 401', async () => {
    const response = await probe().request('/probe');
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: ERROR_CODES.UNAUTHORIZED });
  });

  it('rejects a non-admin session with 403', async () => {
    const app = withIdentity(regularUser, session);
    app.get('/probe', requireAdmin, (c) => c.json({ ok: true }));
    const response = await app.request('/probe');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: ERROR_CODES.FORBIDDEN });
  });

  it('allows an admin session through to the handler', async () => {
    const app = withIdentity(adminUser, session);
    app.get('/probe', requireAdmin, (c) => c.json({ ok: true }));
    const response = await app.request('/probe');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});

describe('discovery admin route authorization', () => {
  const adminEndpoints: Array<[string, string]> = [
    ['GET', '/api/admin/discovery/source-records'],
    ['GET', '/api/admin/discovery/categories'],
    ['GET', '/api/admin/discovery/categories/cat-1/source-records'],
    ['POST', '/api/admin/discovery/categories'],
    ['DELETE', '/api/admin/discovery/categories/cat-1'],
    ['PATCH', '/api/admin/discovery/categories/cat-1/labels'],
    ['PUT', '/api/admin/discovery/source-records/sr-1/categories/cat-1'],
    ['DELETE', '/api/admin/discovery/source-records/sr-1/categories/cat-1'],
  ];

  function adminApp(user: AuthSessionUser | null, activeSession: AuthSession | null) {
    const app = withIdentity(user, activeSession);
    app.route('/', discoveryAdminRoutes);
    return app;
  }

  it.each(adminEndpoints)('guards %s %s with requireAdmin', async (method, path) => {
    const anonymous = await adminApp(null, null).request(path, { method });
    expect(anonymous.status).toBe(401);

    const nonAdmin = await adminApp(regularUser, session).request(path, { method });
    expect(nonAdmin.status).toBe(403);
  });
});
