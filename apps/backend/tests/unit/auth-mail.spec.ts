import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildVerificationUrl, sendAuthMail, shouldLogDevAuthLink } from '@/lib/auth-mail';

describe('auth-mail', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('buildVerificationUrl encodes token for verify-email route', () => {
    expect(buildVerificationUrl('abc+def', 'http://localhost:3000')).toBe(
      'http://localhost:3000/verify-email?token=abc%2Bdef',
    );
  });

  it('shouldLogDevAuthLink is true only in development without RESEND_API_KEY', () => {
    expect(shouldLogDevAuthLink({ NODE_ENV: 'development', RESEND_API_KEY: undefined })).toBe(true);
    expect(shouldLogDevAuthLink({ NODE_ENV: 'production', RESEND_API_KEY: undefined })).toBe(false);
    expect(shouldLogDevAuthLink({ NODE_ENV: 'development', RESEND_API_KEY: 're_test_key' })).toBe(false);
    expect(shouldLogDevAuthLink({ NODE_ENV: 'test', RESEND_API_KEY: undefined })).toBe(false);
  });

  it('resolves after the provider accepts the message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'email_123' }), { status: 200 })),
    );

    await expect(
      sendAuthMail({
        operation: 'verification',
        userId: 'user-1',
        to: 'person@example.com',
        subject: 'Verify',
        text: 'Verify your email',
      }),
    ).resolves.toBeUndefined();
  });

  it('surfaces provider rejection without logging message content', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ name: 'rate_limit_exceeded', message: 'try later' }), { status: 429 }),
        ),
    );

    await expect(
      sendAuthMail({
        operation: 'password_reset',
        userId: 'user-1',
        to: 'person@example.com',
        subject: 'Reset',
        text: 'Reset your password',
      }),
    ).rejects.toMatchObject({ code: 'AUTH_MAIL_PROVIDER_ERROR' });
  });

  it('bounds a provider request that never completes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise(() => undefined)),
    );

    await expect(
      sendAuthMail({
        operation: 'verification',
        userId: 'user-1',
        to: 'person@example.com',
        subject: 'Verify',
        text: 'Verify your email',
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_MAIL_TIMEOUT' });
  });
});
