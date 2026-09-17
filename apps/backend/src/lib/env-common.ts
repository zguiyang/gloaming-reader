import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv, type DotenvPopulateInput } from 'dotenv';
import { z } from 'zod';

/** dotenv's processEnv type disallows `undefined` values; Node's ProcessEnv allows them. */
function asDotenvProcessEnv(processEnv: NodeJS.ProcessEnv): DotenvPopulateInput {
  return processEnv as DotenvPopulateInput;
}

const envFilePath = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env');
const testEnvFilePath = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env.test');

const TEST_DATABASE_NAME = 'gloaming_test';

/** Env keys whose values must never appear in validation output. */
const SECRET_ENV_KEYS = new Set([
  'BETTER_AUTH_SECRET',
  'DATABASE_URL',
  'REDIS_URL',
  'RESEND_API_KEY',
  'GITHUB_CLIENT_SECRET',
  'S3_SECRET_ACCESS_KEY',
  'S3_ACCESS_KEY_ID',
  'LLM_CONFIG_ENCRYPTION_KEY',
  'TEST_DATABASE_URL',
]);

function databaseNameFromUrl(url: string): string {
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, '').split('/')[0];
  if (!name) {
    throw new Error('Cannot parse database name from TEST_DATABASE_URL');
  }
  return decodeURIComponent(name);
}

/**
 * Vitest only — require TEST_DATABASE_URL; never fall back to development DATABASE_URL.
 * Loads `.env.test` as defaults into `processEnv` only (does not mutate global process.env
 * when a custom object is passed).
 */
function applyTestDatabaseEnv(processEnv: NodeJS.ProcessEnv): void {
  if (processEnv.VITEST !== 'true') {
    return;
  }

  loadDotenv({ path: testEnvFilePath, override: false, processEnv: asDotenvProcessEnv(processEnv) });

  const testUrl = processEnv.TEST_DATABASE_URL?.trim();
  if (!testUrl) {
    delete processEnv.DATABASE_URL;
    throw new Error(
      [
        'TEST_DATABASE_URL is required for backend tests.',
        'Copy apps/backend/.env.test.example → apps/backend/.env.test, create database gloaming_test, then run: pnpm db:migrate:test',
      ].join(' '),
    );
  }

  const dbName = databaseNameFromUrl(testUrl);
  if (dbName !== TEST_DATABASE_NAME) {
    delete processEnv.DATABASE_URL;
    throw new Error(
      `TEST_DATABASE_URL must point exactly to the test database "${TEST_DATABASE_NAME}", got "${dbName}".`,
    );
  }

  // Intentional: pin DATABASE_URL to the verified test URL for isolation.
  processEnv.DATABASE_URL = testUrl;
}

/** Empty string in `.env` → treat as unset. */
const emptyToUndefined = (value: unknown) => (value === '' || value === undefined ? undefined : value);

/** Environment required by database, queue, storage, logging, and Worker code. */
export const commonEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().min(1).default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  /**
   * 32-byte key material as base64 or 64-char hex — used to encrypt LLM API keys at rest.
   * Generate: `openssl rand -base64 32`
   */
  LLM_CONFIG_ENCRYPTION_KEY: z.string().min(1),

  /** S3-compatible object storage configuration. */
  S3_ENDPOINT: z.preprocess(emptyToUndefined, z.string().url().optional()),
  S3_REGION: z.preprocess(emptyToUndefined, z.string().min(1)),
  S3_BUCKET: z.preprocess(emptyToUndefined, z.string().min(1)),
  S3_ACCESS_KEY_ID: z.preprocess(emptyToUndefined, z.string().min(1)),
  S3_SECRET_ACCESS_KEY: z.preprocess(emptyToUndefined, z.string().min(1)),
  S3_FORCE_PATH_STYLE: z.preprocess(
    (value) => (value === '' || value === undefined ? 'false' : value),
    z.enum(['true', 'false']).transform((value) => value === 'true'),
  ),
});

export type CommonEnv = z.infer<typeof commonEnvSchema>;

/**
 * Format validation failures without printing secrets, tokens, or full connection strings.
 * Uses path + Zod message only (Zod 4 messages do not embed received values).
 */
export function formatEnvValidationError(error: unknown): string {
  if (error instanceof z.ZodError) {
    const lines = error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      if (SECRET_ENV_KEYS.has(path)) {
        return `  - ${path}: invalid or missing (value omitted)`;
      }
      return `  - ${path}: ${issue.message}`;
    });
    return ['Invalid environment configuration:', ...lines].join('\n');
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Invalid environment configuration';
}

/** Pure Zod parse — no dotenv. Used by unit tests and runtime-specific loaders. */
export function parseCommonEnvConfig(processEnv: NodeJS.ProcessEnv): CommonEnv {
  const result = commonEnvSchema.safeParse(processEnv);
  if (!result.success) {
    throw new Error(formatEnvValidationError(result.error));
  }
  return result.data;
}

/** Load common `.env` defaults, enforce test isolation, then parse common runtime config. */
export function loadCommonEnvConfig(processEnv: NodeJS.ProcessEnv = process.env): CommonEnv {
  loadDotenv({ path: envFilePath, override: false, processEnv: asDotenvProcessEnv(processEnv) });
  applyTestDatabaseEnv(processEnv);
  return parseCommonEnvConfig(processEnv);
}

/** Worker and API share the same object-storage configuration contract. */
export function isS3ObjectStorageConfigured(
  config: Pick<CommonEnv, 'S3_REGION' | 'S3_BUCKET' | 'S3_ACCESS_KEY_ID' | 'S3_SECRET_ACCESS_KEY'> = commonEnv,
): boolean {
  return Boolean(config.S3_REGION && config.S3_BUCKET && config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY);
}

/** Worker runtime intentionally loads only the common configuration. */
export const commonEnv = loadCommonEnvConfig();
