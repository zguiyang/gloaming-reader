import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { username } from 'better-auth/plugins';
import { count } from 'drizzle-orm';
import { Resend } from 'resend';

import * as schema from '@gloaming/db/schema';
import {
  AUTH_PASSWORD_POLICY,
  AUTH_USER_ROLE,
  AUTH_USERNAME_POLICY,
  bootstrapRoleForNewUser,
  isValidUsername,
} from '@gloaming/shared/auth';

import { db } from '@/db';
import { buildVerificationUrl, logDevAuthLink } from '@/lib/auth-mail';
import { env } from '@/lib/env';
import { authLogger } from '@/lib/logger';

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

const DICEBEAR_STYLES = ['lorelei', 'adventurer', 'big-smile', 'croodles', 'personas', 'avataaars'] as const;

function diceBearAvatarUrl(seed: string): string {
  const style = DICEBEAR_STYLES[Math.floor(Math.random() * DICEBEAR_STYLES.length)]!;
  return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}`;
}

async function sendMail(input: { to: string; subject: string; text: string }): Promise<void> {
  if (!resend) {
    authLogger.warn({ to: input.to, subject: input.subject }, 'RESEND_API_KEY unset; email not sent');
    return;
  }

  const { error } = await resend.emails.send({
    from: `${env.MAIL_FROM_NAME} <${env.MAIL_FROM_ADDRESS}>`,
    to: input.to,
    subject: input.subject,
    text: input.text,
  });

  if (error) {
    // Log only — auth flows should not fail open/closed on transactional mail transport errors.
    authLogger.error({ error }, 'Failed to send email via Resend');
  }
}

export const auth = betterAuth({
  // Public origin browsers use (Next BFF proxies /api/auth → Hono).
  baseURL: env.FRONTEND_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.FRONTEND_URL],
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: AUTH_PASSWORD_POLICY.minLength,
    maxPasswordLength: AUTH_PASSWORD_POLICY.maxLength,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, token }) => {
      const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${encodeURIComponent(token)}`;
      void sendMail({
        to: user.email,
        subject: 'Reset your Gloaming password',
        text: `Reset your password: ${resetUrl}`,
      });
    },
  },
  emailVerification: {
    sendOnSignIn: true,
    sendVerificationEmail: async ({ user, token }) => {
      const verifyUrl = buildVerificationUrl(token);
      logDevAuthLink({ to: user.email, url: verifyUrl, kind: 'verify-email' });
      void sendMail({
        to: user.email,
        subject: 'Verify your Gloaming email',
        text: `Verify your email: ${verifyUrl}`,
      });
    },
  },
  user: {
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
          const [row] = await db.select({ value: count() }).from(schema.user);
          const existingUserCount = Number(row?.value ?? 0);
          return {
            data: {
              ...user,
              image: user.image ?? diceBearAvatarUrl(user.email || user.id),
              role: bootstrapRoleForNewUser(existingUserCount),
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
