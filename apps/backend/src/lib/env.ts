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
  'R2_SECRET_ACCESS_KEY',
  'R2_ACCESS_KEY_ID',
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
      `TEST_DATABASE_URL must point exactly at the test database "${TEST_DATABASE_NAME}", got "${dbName}".`,
    );
  }

  // Intentional: pin DATABASE_URL to the verified test URL for isolation.
  processEnv.DATABASE_URL = testUrl;
}

/** Empty string in `.env` → treat as unset. */
const emptyToUndefined = (value: unknown) => (value === '' || value === undefined ? undefined : value);

/**
 * Single env schema for API, Worker, and scripts.
 * No NODE_ENV-specific required-field branches: boot always needs full runtime config.
 * RESEND_API_KEY and all four R2_* variables are required (no half-configured R2).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3333),
  HOST: z.string().min(1).default('localhost'),
  LOG_LEVEL: z.string().min(1).default('info'),

  FRONTEND_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(16),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  RESEND_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1)),
  MAIL_FROM_ADDRESS: z.string().email(),
  MAIL_FROM_NAME: z.string().min(1),

  /**
   * 32-byte key material as base64 or 64-char hex — used to encrypt LLM API keys at rest.
   * Generate: `openssl rand -base64 32`
   */
  LLM_CONFIG_ENCRYPTION_KEY: z.string().min(1),

  /** Object storage driver — only `r2` is implemented today. */
  OSS_DRIVER: z.enum(['r2']).default('r2'),
  R2_ACCOUNT_ID: z.preprocess(emptyToUndefined, z.string().min(1)),
  R2_BUCKET: z.preprocess(emptyToUndefined, z.string().min(1)),
  R2_ACCESS_KEY_ID: z.preprocess(emptyToUndefined, z.string().min(1)),
  R2_SECRET_ACCESS_KEY: z.preprocess(emptyToUndefined, z.string().min(1)),
});

export type Env = z.infer<typeof envSchema>;

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

/** Pure Zod parse — no dotenv. Used by unit tests and loadEnvConfig. */
export function parseEnvConfig(processEnv: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(processEnv);
  if (!result.success) {
    throw new Error(formatEnvValidationError(result.error));
  }
  return result.data;
}

/**
 * Load `apps/backend/.env` as defaults only (does not override keys already set on
 * `processEnv`), then Zod-parse. Throws on invalid/missing required vars so the
 * process fails at boot.
 */
export function loadEnvConfig(processEnv: NodeJS.ProcessEnv = process.env): Env {
  loadDotenv({ path: envFilePath, override: false, processEnv: asDotenvProcessEnv(processEnv) });
  applyTestDatabaseEnv(processEnv);
  return parseEnvConfig(processEnv);
}

/** Alias of loadEnvConfig — prefer this name at call sites that only need the typed config. */
export function getEnvConfig(processEnv: NodeJS.ProcessEnv = process.env): Env {
  return loadEnvConfig(processEnv);
}

/** Eager boot validation for API / Worker / any module that imports `env`. */
export const env = loadEnvConfig();

/** Always true under the required R2 schema; retained for call-site clarity and tests. */
export function isR2ObjectStorageConfigured(config: Env = env): boolean {
  return Boolean(config.R2_ACCOUNT_ID && config.R2_BUCKET && config.R2_ACCESS_KEY_ID && config.R2_SECRET_ACCESS_KEY);
}
