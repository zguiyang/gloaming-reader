/**
 * Side-effect-free auth validation policy (password / username).
 * SSOT for apps/web + apps/backend — safe to import from the browser bundle.
 */

export const AUTH_PASSWORD_POLICY = {
  minLength: 8,
  maxLength: 128,
} as const;

export const AUTH_USERNAME_POLICY = {
  minLength: 3,
  maxLength: 50,
  /** Letters, digits, dots, underscores. */
  pattern: /^[a-zA-Z0-9._]+$/,
} as const;

export const AUTH_USER_ROLE = 'user' as const;
export const AUTH_ADMIN_ROLE = 'admin' as const;

export type AuthRole = typeof AUTH_USER_ROLE | typeof AUTH_ADMIN_ROLE;

export function isAdminRole(role: string | null | undefined): boolean {
  return role === AUTH_ADMIN_ROLE;
}

export function isValidUsername(username: string): boolean {
  return AUTH_USERNAME_POLICY.pattern.test(username);
}
