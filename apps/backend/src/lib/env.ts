import { z } from 'zod';

import { commonEnvSchema, formatEnvValidationError, loadCommonEnvConfig } from '@/lib/env-common';

/** API-only environment required by HTTP, Better Auth, and transactional mail. */
const apiEnvSchema = commonEnvSchema.extend({
  HOST: z.string().min(1).default('localhost'),
  PORT: z.coerce.number().int().positive().default(3333),

  FRONTEND_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(16),

  /** Optional OAuth credentials; each provider must be configured as a pair. */
  GITHUB_CLIENT_ID: z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    z.string().min(1).optional(),
  ),
  GITHUB_CLIENT_SECRET: z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    z.string().min(1).optional(),
  ),

  RESEND_API_KEY: z.preprocess((value) => (value === '' || value === undefined ? undefined : value), z.string().min(1)),
  MAIL_FROM_ADDRESS: z.string().email(),
  MAIL_FROM_NAME: z.string().min(1),
});

const completeApiEnvSchema = apiEnvSchema.superRefine((config, context) => {
  const hasClientId = Boolean(config.GITHUB_CLIENT_ID);
  const hasClientSecret = Boolean(config.GITHUB_CLIENT_SECRET);
  if (hasClientId === hasClientSecret) {
    return;
  }

  const missingKey = hasClientId ? 'GITHUB_CLIENT_SECRET' : 'GITHUB_CLIENT_ID';
  context.addIssue({
    code: z.ZodIssueCode.custom,
    path: [missingKey],
    message: `must be provided together with ${hasClientId ? 'GITHUB_CLIENT_ID' : 'GITHUB_CLIENT_SECRET'}`,
  });
});

export type Env = z.infer<typeof completeApiEnvSchema>;

/** Pure Zod parse for API configuration. */
export function parseEnvConfig(processEnv: NodeJS.ProcessEnv): Env {
  const result = completeApiEnvSchema.safeParse(processEnv);
  if (!result.success) {
    throw new Error(formatEnvValidationError(result.error));
  }
  return result.data;
}

/** Load common defaults and test isolation, then validate API configuration. */
export function loadEnvConfig(processEnv: NodeJS.ProcessEnv = process.env): Env {
  loadCommonEnvConfig(processEnv);
  return parseEnvConfig(processEnv);
}

/** Alias of loadEnvConfig — prefer this name at call sites that only need typed API config. */
export function getEnvConfig(processEnv: NodeJS.ProcessEnv = process.env): Env {
  return loadEnvConfig(processEnv);
}

/** Eager boot validation for the API and API-only scripts. */
export const env = loadEnvConfig();

export { formatEnvValidationError, isS3ObjectStorageConfigured } from '@/lib/env-common';
