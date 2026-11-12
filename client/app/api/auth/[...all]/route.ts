import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '@/server/infra/auth/auth';

/**
 * Better Auth on Next Route Handlers (no Hono).
 * Client baClient uses same-origin basePath `/api/auth`.
 */
export const { GET, POST } = toNextJsHandler(auth);
