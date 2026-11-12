import { z } from 'zod';

import { t } from '@gloaming/i18n';

import { AUTH_ROUTES } from '@/constants';
import { getClientLocale } from '@/lib/client-locale';
import type {
  ForgotPasswordBody,
  LoginBody,
  RegisterBody,
  ResendVerificationBody,
  ResetPasswordBody,
  User,
} from '@/lib/validations/auth';
import { userSchema } from '@/lib/validations/auth';

import { baClient } from './ba-client';
import { resolvePostAuthPath, resolveSocialAuthErrorPath } from './post-auth-redirect';
import type { AuthError, AuthResult } from './types';

export type SocialProvider = 'github';

function clientAuthMessage(key: string): string {
  return t(getClientLocale(), key);
}

function toAuthError(error: { message?: string | null; code?: string | number; status?: number } | null): AuthError {
  return {
    message: clientAuthMessage('auth.api.requestFailed'),
    code: typeof error?.code === 'string' || typeof error?.code === 'number' ? String(error.code) : undefined,
    status: error?.status,
  };
}

function parseUser(raw: unknown): AuthResult<User> {
  const parsed = userSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      data: null,
      error: { message: clientAuthMessage('auth.api.invalidAuthResponse'), status: 502 },
    };
  }
  return { data: parsed.data, error: null };
}

export function looksLikeEmail(value: string): boolean {
  return z.email().safeParse(value).success;
}

export async function register(input: RegisterBody): Promise<AuthResult<User>> {
  const { data, error } = await baClient.signUp.email({
    email: input.email,
    password: input.password,
    name: input.name,
    username: input.username,
    callbackURL: AUTH_ROUTES.verifyEmail,
  });

  if (error) {
    return { data: null, error: toAuthError(error) };
  }

  return parseUser(data?.user ?? data);
}

export async function login(input: LoginBody): Promise<AuthResult<User>> {
  const login = input.login.trim();
  const result = looksLikeEmail(login)
    ? await baClient.signIn.email({ email: login, password: input.password })
    : await baClient.signIn.username({ username: login, password: input.password });

  if (result.error) {
    return { data: null, error: toAuthError(result.error) };
  }

  return parseUser(result.data?.user ?? result.data);
}

export async function loginWithSocial(provider: SocialProvider): Promise<AuthResult<null>> {
  try {
    const { error } = await baClient.signIn.social({
      provider,
      callbackURL: resolvePostAuthPath(),
      errorCallbackURL: resolveSocialAuthErrorPath(),
    });

    if (error) {
      return { data: null, error: toAuthError(error) };
    }

    return { data: null, error: null };
  } catch (error) {
    return { data: null, error: toAuthError(error instanceof Error ? error : null) };
  }
}

export async function logout(): Promise<AuthResult<{ ok: boolean }>> {
  // Prefer Next route so HttpOnly BA cookie is cleared on the web origin.
  try {
    const response = await fetch('/api/auth/logout', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      const { error } = await baClient.signOut();
      if (error) {
        return { data: null, error: toAuthError(error) };
      }
    }
  } catch {
    const { error } = await baClient.signOut();
    if (error) {
      return { data: null, error: toAuthError(error) };
    }
  }
  return { data: { ok: true }, error: null };
}

export async function resendVerificationEmail(
  email: ResendVerificationBody['email'],
): Promise<AuthResult<{ ok: boolean }>> {
  const { error } = await baClient.sendVerificationEmail({
    email,
    callbackURL: AUTH_ROUTES.verifyEmail,
  });
  if (error) {
    return { data: null, error: toAuthError(error) };
  }
  return { data: { ok: true }, error: null };
}

export async function verifyEmail(token: string): Promise<AuthResult<{ ok: boolean }>> {
  // Omit callbackURL so Better Auth returns JSON instead of a 302 redirect.
  // Redirect + `redirect: 'manual'` through the Next rewrite is unreliable in the browser.
  const qs = new URLSearchParams({ token });
  const response = await fetch(`/api/auth/verify-email?${qs.toString()}`, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    const message = clientAuthMessage('auth.verifyEmail.failed');
    try {
      const body = (await response.json()) as { message?: string; code?: string };
      return {
        data: null,
        error: { message, status: response.status, code: body.code },
      };
    } catch {
      return { data: null, error: { message, status: response.status } };
    }
  }

  try {
    const body = (await response.json()) as { status?: boolean };
    if (body.status === true) {
      return { data: { ok: true }, error: null };
    }
  } catch {
    // Some BA versions may return an empty body on success.
  }

  return { data: { ok: true }, error: null };
}

export async function forgotPassword(email: ForgotPasswordBody['email']): Promise<AuthResult<{ ok: boolean }>> {
  const redirectTo =
    typeof window !== 'undefined' ? `${window.location.origin}${AUTH_ROUTES.resetPassword}` : AUTH_ROUTES.resetPassword;

  const { error } = await baClient.requestPasswordReset({
    email,
    redirectTo,
  });
  if (error) {
    return { data: null, error: toAuthError(error) };
  }
  return { data: { ok: true }, error: null };
}

export async function resetPassword(input: ResetPasswordBody): Promise<AuthResult<{ ok: boolean }>> {
  const { error } = await baClient.resetPassword({
    newPassword: input.password,
    token: input.token,
  });
  if (error) {
    return { data: null, error: toAuthError(error) };
  }
  return { data: { ok: true }, error: null };
}

export type LinkedAccount = {
  id: string;
  providerId: string;
  accountId: string;
  userId: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  scopes?: string[];
};

export async function listAccounts(): Promise<AuthResult<LinkedAccount[]>> {
  const { data, error } = await baClient.listAccounts();
  if (error) {
    return { data: null, error: toAuthError(error) };
  }
  return { data: data ?? [], error: null };
}

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<AuthResult<{ ok: boolean }>> {
  const { error } = await baClient.changePassword({
    currentPassword: input.currentPassword,
    newPassword: input.newPassword,
  });
  if (error) {
    return { data: null, error: toAuthError(error) };
  }
  return { data: { ok: true }, error: null };
}

export async function changeEmail(newEmail: string): Promise<AuthResult<{ ok: boolean }>> {
  const { error } = await baClient.changeEmail({
    newEmail,
    callbackURL: AUTH_ROUTES.verifyEmail,
  });
  if (error) {
    return { data: null, error: toAuthError(error) };
  }
  return { data: { ok: true }, error: null };
}
