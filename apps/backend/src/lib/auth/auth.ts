import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { username } from 'better-auth/plugins';

import * as schema from '@gloaming/db/schema';
import { AUTH_PASSWORD_POLICY, AUTH_USER_ROLE, AUTH_USERNAME_POLICY, isValidUsername } from '@gloaming/shared/auth';

import { db } from '@/db';
import { bindAuthDatabaseForAdapter, resolveRoleForNewUser } from '@/lib/auth/bootstrap';
import { buildVerificationUrl, logDevAuthLink, sendAuthMail } from '@/lib/auth/mail';
import { env } from '@/lib/env';

const authDatabase = bindAuthDatabaseForAdapter(db);

const socialProviders =
  env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
    ? {
        github: {
          clientId: env.GITHUB_CLIENT_ID,
          clientSecret: env.GITHUB_CLIENT_SECRET,
          scope: ['read:user', 'user:email'],
        },
      }
    : {};

const DICEBEAR_STYLES = ['lorelei', 'adventurer', 'big-smile', 'croodles', 'personas', 'avataaars'] as const;

function diceBearAvatarUrl(seed: string): string {
  const style = DICEBEAR_STYLES[Math.floor(Math.random() * DICEBEAR_STYLES.length)]!;
  return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}`;
}

export const auth = betterAuth({
  // Public origin browsers use (Next BFF proxies /api/auth → Hono).
  baseURL: env.FRONTEND_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.FRONTEND_URL],
  database: drizzleAdapter(authDatabase, {
    provider: 'pg',
    transaction: true,
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  socialProviders,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: AUTH_PASSWORD_POLICY.minLength,
    maxPasswordLength: AUTH_PASSWORD_POLICY.maxLength,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, token }) => {
      const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${encodeURIComponent(token)}`;
      await sendAuthMail({
        operation: 'password_reset',
        userId: user.id,
        to: user.email,
        subject: 'Reset your Gloaming password',
        text: `Reset your password: ${resetUrl}`,
      });
    },
  },
  rateLimit: {
    // Better Auth applies its built-in limiter to /api/auth/* in production.
    window: 60,
    max: 60,
    customRules: {
      '/sign-in/email': { window: 10 * 60, max: 10 },
      '/sign-up/email': { window: 60 * 60, max: 10 },
      '/send-verification-email': { window: 10 * 60, max: 5 },
      '/forget-password': { window: 10 * 60, max: 5 },
      '/reset-password': { window: 10 * 60, max: 10 },
      '/change-password': { window: 10 * 60, max: 10 },
      '/change-email': { window: 10 * 60, max: 5 },
    },
  },
  emailVerification: {
    sendOnSignIn: true,
    sendVerificationEmail: async ({ user, token }) => {
      const verifyUrl = buildVerificationUrl(token);
      logDevAuthLink({ to: user.email, url: verifyUrl, kind: 'verify-email' });
      await sendAuthMail({
        operation: 'verification',
        userId: user.id,
        to: user.email,
        subject: 'Verify your Gloaming email',
        text: `Verify your email: ${verifyUrl}`,
      });
    },
  },
  user: {
    changeEmail: {
      enabled: true,
    },
    additionalFields: {
      role: {
        type: 'string',
        required: false,
        defaultValue: AUTH_USER_ROLE,
        input: false,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const role = await resolveRoleForNewUser();
          return {
            data: {
              ...user,
              image: user.image ?? diceBearAvatarUrl(user.email || user.id),
              role,
            },
          };
        },
      },
    },
  },
  plugins: [
    username({
      minUsernameLength: AUTH_USERNAME_POLICY.minLength,
      maxUsernameLength: AUTH_USERNAME_POLICY.maxLength,
      usernameValidator: (value) => isValidUsername(value),
    }),
  ],
});

export type AuthSessionUser = typeof auth.$Infer.Session.user;
export type AuthSession = typeof auth.$Infer.Session.session;
