'use client';

import { useSyncExternalStore } from 'react';

import { type User, userSchema } from '@/lib/validations/auth';

import { logout as apiLogout } from './api';
import { baClient } from './ba-client';
import type { AuthError } from './types';

type SessionState = {
  data: { user: User } | null;
  error: AuthError | null;
  isPending: boolean;
  refresh: () => void;
};

function subscribeToHydration() {
  return () => {};
}

function getClientHydrationSnapshot() {
  return true;
}

function getServerHydrationSnapshot() {
  return false;
}

function mapUser(raw: unknown): User | null {
  const parsed = userSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Soft session UX via BA's shared client store (one get-session hydrate, many subscribers).
 * Prefer lifting `userId` into feature trees instead of nesting extra session reads.
 */
export function useSession(): SessionState {
  const session = baClient.useSession();
  const isMounted = useSyncExternalStore(subscribeToHydration, getClientHydrationSnapshot, getServerHydrationSnapshot);

  // Better Auth can resolve its client cache before hydration, while SSR has no
  // session snapshot. Keep the server and first client render on the pending UI.
  const user = isMounted && session.data?.user ? mapUser(session.data.user) : null;
  const isPending = !isMounted || session.isPending;

  let error: AuthError | null = null;
  if (isMounted && session.error) {
    const err = session.error as { message?: string; code?: string; status?: number };
    error = {
      message: err.message || 'Session refresh failed',
      code: typeof err.code === 'string' ? err.code : undefined,
      status: err.status,
    };
  } else if (!isPending && !user) {
    error = { message: 'Unauthorized', status: 401 };
  }

  return {
    data: user ? { user } : null,
    error,
    isPending,
    refresh: () => {
      void session.refetch();
    },
  };
}

export async function signOut(): Promise<{ error: AuthError | null }> {
  return { error: (await apiLogout()).error };
}
