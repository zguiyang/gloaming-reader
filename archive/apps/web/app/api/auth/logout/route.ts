import { NextResponse } from 'next/server';

import { expiredSessionCookieOptions, SESSION_COOKIE, SESSION_COOKIE_SECURE } from '@/lib/auth/session-cookies';

/** Clear HttpOnly BA session cookie on the web origin, then notify Hono BA. */
export async function DELETE(request: Request) {
  try {
    await fetch(`${process.env.API_INTERNAL_URL}/api/auth/sign-out`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        cookie: request.headers.get('cookie') ?? '',
      },
      body: JSON.stringify({}),
    });
  } catch {
    // still clear local cookie
  }

  const response = NextResponse.json({ ok: true });
  const options = expiredSessionCookieOptions();
  response.cookies.set(SESSION_COOKIE, '', options);
  response.cookies.set(SESSION_COOKIE_SECURE, '', { ...options, secure: true });
  return response;
}
