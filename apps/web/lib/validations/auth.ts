import { z } from 'zod';

import { AUTH_PASSWORD_POLICY, AUTH_USERNAME_POLICY } from '@gloaming/shared/auth';

const passwordSchema = z.string().min(AUTH_PASSWORD_POLICY.minLength).max(AUTH_PASSWORD_POLICY.maxLength);

const usernameSchema = z
  .string()
  .trim()
  .min(AUTH_USERNAME_POLICY.minLength)
  .max(AUTH_USERNAME_POLICY.maxLength)
  .regex(AUTH_USERNAME_POLICY.pattern);

/** Align with BA / web form email normalization. */
const emailSchema = z.string().trim().pipe(z.email());

/**
 * Public user JSON (Better Auth wire shape).
 * Dates may be ISO strings (JSON) or Date when parsed from BA client session.
 */
export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  name: z.string(),
  username: z.string().nullable().optional(),
  displayUsername: z.string().nullable().optional(),
  role: z.string(),
  image: z.string().nullable().optional(),
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]).nullable().optional(),
});

export type User = z.infer<typeof userSchema>;

/** Web sign-in form: email or username in a single `login` field. */
export const loginBodySchema = z.object({
  login: z.string().trim().min(1).max(254),
  password: passwordSchema,
});

export type LoginBody = z.infer<typeof loginBodySchema>;

/** Product register fields mapped onto BA `signUp.email` (+ username plugin). */
export const registerBodySchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(100),
});

export type RegisterBody = z.infer<typeof registerBodySchema>;

export const forgotPasswordBodySchema = z.object({
  email: emailSchema,
});

export type ForgotPasswordBody = z.infer<typeof forgotPasswordBodySchema>;

export const resetPasswordBodySchema = z.object({
  token: z.string().trim().min(1),
  password: passwordSchema,
});

export type ResetPasswordBody = z.infer<typeof resetPasswordBodySchema>;

export const resendVerificationBodySchema = z.object({
  email: emailSchema,
});

export type ResendVerificationBody = z.infer<typeof resendVerificationBodySchema>;

/** Sign-in form = product login body (`login` may be email or username). */
export const signInSchema = loginBodySchema;

export type SignInValues = LoginBody;

/** Sign-up form aligns with BA `name` + username plugin fields. */
export const signUpSchema = registerBodySchema;

export type SignUpValues = RegisterBody;

export const forgotPasswordSchema = forgotPasswordBodySchema;

export type ForgotPasswordValues = ForgotPasswordBody;

/** Reset form: password (+ confirm). Token comes from the URL, not the form schema. */
export const resetPasswordSchema = resetPasswordBodySchema
  .pick({ password: true })
  .extend({
    passwordConfirm: z.string().min(1, 'Confirm your password'),
  })
  .refine((value) => value.password === value.passwordConfirm, {
    message: 'Passwords do not match',
    path: ['passwordConfirm'],
  });

export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
