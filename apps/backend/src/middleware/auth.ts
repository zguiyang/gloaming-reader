import { createMiddleware } from 'hono/factory';

import { isAdminRole } from '@gloaming/shared/auth';

import { HTTP_STATUS } from '@/constants';
import { auth, type AuthSession, type AuthSessionUser } from '@/lib/auth';
import { sendError } from '@/lib/response';

export type AuthVariables = {
  user: AuthSessionUser | null;
  session: AuthSession | null;
};

/** Hydrate BA session onto context (null when anonymous). */
export const sessionMiddleware = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set('user', result?.user ?? null);
  c.set('session', result?.session ?? null);
  await next();
});

/** Require a valid Better Auth session — 401 when missing. */
export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const user = c.get('user');
  const session = c.get('session');
  if (!user || !session) {
    return sendError(c, 'Unauthorized', HTTP_STATUS.UNAUTHORIZED);
  }
  await next();
});

/** Require an authenticated administrator — 401 when anonymous, 403 when non-admin. */
export const requireAdmin = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const user = c.get('user');
  const session = c.get('session');
  if (!user || !session) {
    return sendError(c, 'Unauthorized', HTTP_STATUS.UNAUTHORIZED);
  }
  if (!isAdminRole(user.role)) {
    return sendError(c, 'Forbidden', HTTP_STATUS.FORBIDDEN);
  }
  await next();
});
