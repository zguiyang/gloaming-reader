import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthMailSubmissionError, buildVerificationUrl, sendAuthMail, shouldLogDevAuthLink } from '@/infra/auth/mail';

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

  it('surfaces Resend 429 as AUTH_MAIL_PROVIDER_ERROR without leaking provider body', async () => {
    const providerDetail = 'try later';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ name: 'rate_limit_exceeded', message: providerDetail }), { status: 429 }),
        ),
    );

    let caught: unknown;
    try {
      await sendAuthMail({
        operation: 'verification',
        userId: 'user-1',
        to: 'person@example.com',
        subject: 'Verify',
        text: 'Verify your email',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AuthMailSubmissionError);
    expect(caught).toMatchObject({
      code: 'AUTH_MAIL_PROVIDER_ERROR',
      message: 'Auth email provider rejected the request',
    });
    expect(String((caught as Error).message)).not.toContain(providerDetail);
    expect(String((caught as Error).message)).not.toContain('rate_limit_exceeded');
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
