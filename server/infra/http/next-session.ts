import { headers } from 'next/headers';

import { isAdminRole } from '@/shared/auth';

import { auth, type AuthSession, type AuthSessionUser } from '@/server/infra/auth/auth';
import { HTTP_STATUS } from '@/server/shared/constants';
import { AppError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';

export type RequestIdentity = {
  user: AuthSessionUser | null;
  session: AuthSession | null;
};

/** Resolve Better Auth session from the incoming Next request headers. */
export async function getRequestIdentity(request?: Request): Promise<RequestIdentity> {
  const headerBag = request?.headers ?? (await headers());
  const result = await auth.api.getSession({ headers: headerBag });
  return {
    user: result?.user ?? null,
    session: result?.session ?? null,
  };
}

export function assertAuthenticated(identity: RequestIdentity): asserts identity is {
  user: AuthSessionUser;
  session: AuthSession;
} {
  if (!identity.user || !identity.session) {
    // AppError carries the stable i18n key; a bare `Error('UNAUTHORIZED')` would
    // surface the raw string to the client because `t()` falls back to the key.
    throw new AppError(HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.UNAUTHORIZED);
  }
}

/** Admin gate; also narrows `identity` the same way {@link assertAuthenticated} does. */
export function assertAdmin(identity: RequestIdentity): asserts identity is {
  user: AuthSessionUser;
  session: AuthSession;
} {
  assertAuthenticated(identity);
  const role = (identity.user as AuthSessionUser & { role?: string }).role;
  if (!isAdminRole(role)) {
    throw new AppError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.FORBIDDEN);
  }
}
