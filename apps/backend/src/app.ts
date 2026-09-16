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
import { getClientIp } from '@/middleware/rate-limit';
import { routes } from '@/routes';

/** Guest/API baseline — 60 requests / 60s / IP. Authenticated users bypass this limiter. */
const apiLimiter = rateLimiter({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  keyGenerator: getClientIp,
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

app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/')) {
    return next();
  }
  return sessionMiddleware(c, next);
});

app.use('*', async (c, next) => {
  if (
    c.req.path === '/' ||
    c.req.path === '/api/health' ||
    c.req.path === '/api/health/live' ||
    c.req.path === '/api/health/ready' ||
    c.req.path.startsWith('/api/assets/')
  ) {
    return next();
  }
  if (c.req.path.startsWith('/api/') && c.get('user')) {
    return next();
  }
  // hono-rate-limiter middleware is typed against default Env
  return apiLimiter(c as never, next);
});

app.onError(errorHandler);

app.get('/', (c) => c.json({ ok: true }));

app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

app.route('/', routes);

export default app;
