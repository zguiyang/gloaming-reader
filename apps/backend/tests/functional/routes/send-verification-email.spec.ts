import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { user as userTable } from '@gloaming/db';

import { AuthMailSubmissionError } from '@/infra/auth/mail';
import { db } from '@/infra/db';

const PROVIDER_LEAK_MARKER = 'resend-provider-try-later-rate_limit_exceeded';

const { sendAuthMailMock } = vi.hoisted(() => ({
  sendAuthMailMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/infra/auth/mail', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, sendAuthMail: sendAuthMailMock };
});

import app from '@/app';

const password = 'password123';

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function signUp(input: { email: string; username: string; name: string }) {
  return app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({
      email: input.email,
      password,
      name: input.name,
      username: input.username,
    }),
  });
}

async function sendVerificationEmail(email: string) {
  return app.request('/api/auth/send-verification-email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3000',
      'x-forwarded-for': '203.0.113.10',
    },
    body: JSON.stringify({
      email,
      callbackURL: 'http://localhost:3000/verify-email',
    }),
  });
}

async function responseText(response: Response): Promise<string> {
  return response.text();
}

function expectNoProviderLeak(body: string) {
  expect(body).not.toContain(PROVIDER_LEAK_MARKER);
  expect(body).not.toContain('rate_limit_exceeded');
  expect(body.toLowerCase()).not.toContain('try later');
}

describe('POST /api/auth/send-verification-email (sendAuthMail mocked)', () => {
  const createdEmails: string[] = [];

  beforeEach(() => {
    sendAuthMailMock.mockReset();
    sendAuthMailMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    for (const email of createdEmails) {
      await db.delete(userTable).where(eq(userTable.email, email));
    }
  });

  it('returns success and invokes sendAuthMail for an unverified registrant', async () => {
    const email = uniqueEmail('resend-ok');
    const username = `resend_ok_${Date.now().toString(36)}`;
    createdEmails.push(email);

    expect((await signUp({ email, username, name: 'Resend Ok' })).status).toBe(200);
    sendAuthMailMock.mockClear();

    const response = await sendVerificationEmail(email);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status?: boolean };
    expect(body.status).toBe(true);

    expect(sendAuthMailMock).toHaveBeenCalledTimes(1);
    expect(sendAuthMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'verification',
        to: email,
      }),
    );
  });

  it('surfaces provider rejection without leaking Resend error payload', async () => {
    const email = uniqueEmail('resend-provider');
    const username = `resend_provider_${Date.now().toString(36)}`;
    createdEmails.push(email);

    expect((await signUp({ email, username, name: 'Resend Provider' })).status).toBe(200);
    sendAuthMailMock.mockRejectedValueOnce(
      new AuthMailSubmissionError('AUTH_MAIL_PROVIDER_ERROR', 'Auth email provider rejected the request'),
    );

    const response = await sendVerificationEmail(email);
    expect(response.status).toBeGreaterThanOrEqual(400);
    const text = await responseText(response);
    expectNoProviderLeak(text);
    expect(text).not.toContain(PROVIDER_LEAK_MARKER);
  });

  it('surfaces mail timeout without leaking provider details', async () => {
    const email = uniqueEmail('resend-timeout');
    const username = `resend_timeout_${Date.now().toString(36)}`;
    createdEmails.push(email);

    expect((await signUp({ email, username, name: 'Resend Timeout' })).status).toBe(200);
    sendAuthMailMock.mockRejectedValueOnce(
      new AuthMailSubmissionError('AUTH_MAIL_TIMEOUT', 'Auth email provider timed out'),
    );

    const response = await sendVerificationEmail(email);
    expect(response.status).toBeGreaterThanOrEqual(400);
    const text = await responseText(response);
    expectNoProviderLeak(text);
  });
});
