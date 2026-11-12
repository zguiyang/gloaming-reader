/** Better Auth session cookie names used by the web-origin logout handler. */
export const SESSION_COOKIE = 'better-auth.session_token' as const;

export const SESSION_COOKIE_SECURE = `__Secure-${SESSION_COOKIE}` as const;

export function expiredSessionCookieOptions() {
  return {
    httpOnly: true as const,
    path: '/' as const,
    maxAge: 0,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  };
}
