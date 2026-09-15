import type { User } from '@/lib/validations/auth';

import * as api from './api';
import { signOut, useSession } from './session';

export type { AuthError, AuthResult } from './types';
export type { User };

/**
 * Thin auth façade over Better Auth React client (Hono BA server via `/api` rewrite).
 */
export const authClient = {
  register: api.register,
  login: api.login,
  loginWithSocial: api.loginWithSocial,
  logout: api.logout,
  resendVerificationEmail: api.resendVerificationEmail,
  verifyEmail: api.verifyEmail,
  forgotPassword: api.forgotPassword,
  resetPassword: api.resetPassword,
  listAccounts: api.listAccounts,
  changePassword: api.changePassword,
  changeEmail: api.changeEmail,
  useSession,
  signOut,
};
