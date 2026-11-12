'use client';

import { usernameClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/**
 * Official Better Auth React client — talks to Hono via same-origin `/api/auth/*` rewrite.
 * Web never hosts the auth server. Session lives in BA's shared client store:
 * many `useSession()` subscribers share one atom; avoid inventing a second store.
 */
export const baClient = createAuthClient({
  basePath: '/api/auth',
  plugins: [usernameClient()],
  // Prefer the in-memory session atom; do not re-hit get-session on every focus.
  sessionOptions: {
    refetchOnWindowFocus: false,
    refetchInterval: 0,
  },
});
