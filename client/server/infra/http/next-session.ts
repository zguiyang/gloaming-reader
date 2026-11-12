import { headers } from 'next/headers';

import { isAdminRole } from '@/shared/auth';

import { auth, type AuthSession, type AuthSessionUser } from '@/server/infra/auth/auth';

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
    const error = new Error('UNAUTHORIZED');
    (error as Error & { status: number; code: string }).status = 401;
    (error as Error & { status: number; code: string }).code = 'UNAUTHORIZED';
    throw error;
  }
}

export function assertAdmin(identity: RequestIdentity): void {
  assertAuthenticated(identity);
  const role = (identity.user as AuthSessionUser & { role?: string }).role;
  if (!isAdminRole(role)) {
    const error = new Error('FORBIDDEN');
    (error as Error & { status: number; code: string }).status = 403;
    (error as Error & { status: number; code: string }).code = 'FORBIDDEN';
    throw error;
  }
}
