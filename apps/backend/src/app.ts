import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import { rateLimiter } from 'hono-rate-limiter';

import { HTTP_STATUS } from '@/constants';
import { auth } from '@/lib/auth';
import { env } from '@/lib/env';
import { ERROR_CODES } from '@/lib/error-codes';
import { sendError } from '@/lib/response';
import { type AuthVariables, sessionMiddleware } from '@/middleware/auth';
import { errorHandler } from '@/middleware/error';
import { logger } from '@/middleware/logger';
import { routes } from '@/routes';

/** General API limiter — 60 requests / 60s / IP. In-memory store; swap to Redis when multi-instance. */
const apiLimiter = rateLimiter({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  keyGenerator: (c) => c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown',
  handler: (c) => sendError(c, ERROR_CODES.TOO_MANY_REQUESTS, HTTP_STATUS.TOO_MANY_REQUESTS),
});

const app = new Hono<{ Variables: AuthVariables }>();

app.use('*', requestId());
app.use('*', logger);
app.use(
  '*',
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Accept-Language'],
    maxAge: 86400,
  }),
);
app.use('*', secureHeaders());

app.use('*', async (c, next) => {
  if (c.req.path === '/' || c.req.path === '/api/health' || c.req.path.startsWith('/api/assets/')) {
    return next();
  }
  // hono-rate-limiter middleware is typed against default Env
  return apiLimiter(c as never, next);
});

app.onError(errorHandler);

app.get('/', (c) => c.json({ ok: true }));

app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/')) {
    return next();
  }
  return sessionMiddleware(c, next);
});

app.route('/', routes);

export default app;
