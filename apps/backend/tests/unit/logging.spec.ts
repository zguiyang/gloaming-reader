import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { user as userTable } from '@gloaming/db';

import app from '@/app';
import { db } from '@/db';
import { REDACTED, sanitizeHeaders, sanitizeLogUrl, sanitizeLogValue, serializeLogError } from '@/lib/log-redaction';
import { rootLogger } from '@/lib/logger';
import { createHttpLogger } from '@/middleware/logger';

function createCapturedLogger() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  const logger = pino(
    {
      base: null,
      level: 'info',
      redact: {
        paths: ['password', '*.password', 'headers.Cookie', '*.headers.Cookie'],
        censor: REDACTED,
      },
      serializers: {
        headers: (value) => sanitizeHeaders(value),
        req: sanitizeLogValue,
        res: sanitizeLogValue,
        request: sanitizeLogValue,
        response: sanitizeLogValue,
        error: sanitizeLogValue,
        body: sanitizeLogValue,
        data: sanitizeLogValue,
        config: sanitizeLogValue,
        url: sanitizeLogUrl,
        uri: sanitizeLogUrl,
        err: serializeLogError,
      },
    },
    destination,
  );
  return { logger, lines, flush: () => logger.flush() };
}

describe('sensitive logging redaction', () => {
  it('redacts sensitive headers case-insensitively without preserving cookie pairs', () => {
    const secret = 'SUPER_SECRET_SESSION_VALUE';
    expect(
      sanitizeHeaders({
        Cookie: `session_token=${secret}; locale=zh-CN`,
        AUTHORIZATION: `Bearer ${secret}`,
        'Set-Cookie': `session_token=${secret}; HttpOnly`,
        'X-API-KEY': secret,
        'User-Agent': 'vitest',
      }),
    ).toEqual({
      Cookie: '[REDACTED]',
      AUTHORIZATION: '[REDACTED]',
      'Set-Cookie': '[REDACTED]',
      'X-API-KEY': '[REDACTED]',
      'User-Agent': 'vitest',
    });
  });

  it('redacts request, response, and error data through the real HTTP logger', async () => {
    const sessionSecret = 'SUPER_SECRET_SESSION_VALUE';
    const bearerSecret = 'SUPER_SECRET_BEARER';
    const signedUrlSecret = 'SIGNED_URL_SECRET';
    const { logger, lines, flush } = createCapturedLogger();
    const app = new Hono();

    app.use('*', requestId());
    app.use('*', createHttpLogger(logger));
    app.get('/ok', (c) => {
      c.header('Set-Cookie', `better-auth.session_token=${sessionSecret}; HttpOnly`);
      return c.json({ ok: true });
    });
    app.get('/rejected', (c) => c.text('rejected', 401));
    app.get('/failure', () => {
      throw Object.assign(new Error('upstream failed?token=SHOULD_NOT_APPEAR'), {
        request: { headers: { Authorization: `Bearer ${bearerSecret}` } },
        body: { password: 'SUPER_SECRET_PASSWORD' },
      });
    });
    app.onError((error, c) => {
      c.get('logger').error({ err: error, requestId: c.get('requestId') }, 'safe error');
      return c.text('failure', 500);
    });

    const ok = await app.request('/ok?token=QUERY_SECRET', {
      headers: {
        Cookie: `better-auth.session_token=${sessionSecret}; locale=zh-CN`,
        Authorization: `Bearer ${bearerSecret}`,
      },
    });
    expect(ok.status).toBe(200);

    const rejected = await app.request('/rejected', {
      headers: { cookie: `better-auth.session_token=${sessionSecret}` },
    });
    expect(rejected.status).toBe(401);

    const failure = await app.request('/failure', {
      headers: { cookie: `better-auth.session_token=${sessionSecret}` },
    });
    expect(failure.status).toBe(500);
    logger.info(
      { url: `https://example.test/reset-password?token=${signedUrlSecret}`, password: 'SUPER_SECRET_PASSWORD' },
      'auth URL created',
    );
    flush();

    const output = lines.join('');
    expect(output).not.toContain(sessionSecret);
    expect(output).not.toContain(bearerSecret);
    expect(output).not.toContain('SUPER_SECRET_PASSWORD');
    expect(output).not.toContain(signedUrlSecret);
    expect(output).toContain('upstream failed?token=[REDACTED]');
    expect(output).not.toContain('QUERY_SECRET');
    expect(output).toContain('GET');
    expect(output).toContain('/ok');
    expect(output).toContain('/failure');
    expect(output).toContain('500');
    expect(output).toContain('safe error');
    expect(output).toContain('reqId');
    expect(output).toContain('responseTime');
    expect(output).toContain('set-cookie');
    expect(output).toContain('[REDACTED]');
  });

  it('does not emit a real Better Auth session token in application logs', async () => {
    const email = `log-boundary-${randomUUID()}@example.com`;
    const password = 'LogBoundaryTestPassword123!';
    const username = `log_boundary_${randomUUID().slice(0, 8)}`;
    const stream = rootLogger[pino.symbols.streamSym] as {
      write: (...args: unknown[]) => unknown;
    };
    const originalWrite = stream.write.bind(stream);
    let output = '';
    stream.write = (...args) => {
      output += String(args[0]);
      return originalWrite(...args);
    };

    try {
      const signup = await app.request('/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({ email, password, name: 'Log Boundary', username }),
      });
      expect(signup.status).toBe(200);
      await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.email, email));

      const signin = await app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({ email, password }),
      });
      expect(signin.status).toBe(200);
      const setCookies = signin.headers.getSetCookie?.() ?? [];
      const cookie = (setCookies[0] ?? signin.headers.get('set-cookie') ?? '').split(';')[0]!;
      expect(cookie).toContain('better-auth.session_token=');
      const token = cookie.slice(cookie.indexOf('=') + 1);

      const me = await app.request('/api/me', { headers: { Cookie: cookie } });
      const session = await app.request('/api/auth/get-session', { headers: { Cookie: cookie } });
      const logout = await app.request('/api/auth/sign-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', Cookie: cookie },
        body: '{}',
      });
      expect(me.status).toBe(200);
      expect(session.status).toBe(200);
      expect(logout.status).toBe(200);

      await rootLogger.flush();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(output.split(token).length - 1).toBe(0);
    } finally {
      await db.delete(userTable).where(eq(userTable.email, email));
      stream.write = originalWrite;
    }
  });
});
