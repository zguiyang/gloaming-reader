import { Resend } from 'resend';

import type { Env } from '@/lib/env';
import { env } from '@/lib/env';
import { authLogger } from '@/lib/logger';

export const AUTH_MAIL_TIMEOUT_MS = 10_000;

export type AuthMailOperation = 'verification' | 'password_reset';

export class AuthMailSubmissionError extends Error {
  constructor(
    public readonly code: 'AUTH_MAIL_PROVIDER_ERROR' | 'AUTH_MAIL_TIMEOUT',
    message: string,
  ) {
    super(message);
    this.name = 'AuthMailSubmissionError';
  }
}

const resend = new Resend(env.RESEND_API_KEY);

export function buildVerificationUrl(token: string, frontendUrl: string = env.FRONTEND_URL): string {
  return `${frontendUrl}/verify-email?token=${encodeURIComponent(token)}`;
}

/** Dev-only: log auth links when Resend is not configured. */
export function shouldLogDevAuthLink(config: Pick<Env, 'NODE_ENV' | 'RESEND_API_KEY'> = env): boolean {
  return config.NODE_ENV === 'development' && !config.RESEND_API_KEY;
}

export function logDevAuthLink(input: { to: string; url: string; kind: 'verify-email' }): void {
  if (!shouldLogDevAuthLink()) {
    return;
  }
  authLogger.info(
    { to: input.to, url: input.url, kind: input.kind },
    'Dev auth link (RESEND_API_KEY unset; open in browser)',
  );
}

function providerErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string') {
    return error.name;
  }
  return 'unknown';
}

export async function sendAuthMail(input: {
  operation: AuthMailOperation;
  userId: string;
  to: string;
  subject: string;
  text: string;
  timeoutMs?: number;
}): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutMs = input.timeoutMs ?? AUTH_MAIL_TIMEOUT_MS;

  try {
    const request = resend.emails.send({
      from: `${env.MAIL_FROM_NAME} <${env.MAIL_FROM_ADDRESS}>`,
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
    const { error } = await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new AuthMailSubmissionError('AUTH_MAIL_TIMEOUT', 'Auth email provider timed out')),
          timeoutMs,
        );
      }),
    ]);

    if (error) {
      authLogger.error(
        {
          operation: input.operation,
          userId: input.userId,
          provider: 'resend',
          providerCode: providerErrorCode(error),
        },
        'Auth email submission failed',
      );
      throw new AuthMailSubmissionError('AUTH_MAIL_PROVIDER_ERROR', 'Auth email provider rejected the request');
    }
  } catch (error) {
    if (error instanceof AuthMailSubmissionError && error.code === 'AUTH_MAIL_PROVIDER_ERROR') {
      throw error;
    }

    const code = error instanceof AuthMailSubmissionError ? error.code : providerErrorCode(error);
    authLogger.error(
      { operation: input.operation, userId: input.userId, provider: 'resend', providerCode: code },
      'Auth email submission failed',
    );
    if (error instanceof AuthMailSubmissionError) {
      throw error;
    }
    throw new AuthMailSubmissionError('AUTH_MAIL_PROVIDER_ERROR', 'Auth email provider request failed');
  } finally {
    if (timer) clearTimeout(timer);
  }
}
