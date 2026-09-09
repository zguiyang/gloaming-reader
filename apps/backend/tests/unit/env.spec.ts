import { describe, expect, it } from 'vitest';

import {
  type Env,
  formatEnvValidationError,
  isR2ObjectStorageConfigured,
  loadEnvConfig,
  parseEnvConfig,
} from '@/lib/env';

function validEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    PORT: '3333',
    HOST: 'localhost',
    LOG_LEVEL: 'info',
    FRONTEND_URL: 'http://localhost:3000',
    BETTER_AUTH_SECRET: 'test-secret-at-least-16-chars',
    DATABASE_URL: 'postgresql://localhost:5432/gloaming_test',
    REDIS_URL: 'redis://localhost:6379',
    RESEND_API_KEY: 're_test_key',
    MAIL_FROM_ADDRESS: 'noreply@example.com',
    MAIL_FROM_NAME: 'Gloaming',
    LLM_CONFIG_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    OSS_DRIVER: 'r2',
    R2_ACCOUNT_ID: 'acct',
    R2_BUCKET: 'bucket',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    ...overrides,
  };
}

describe('parseEnvConfig', () => {
  it('accepts a complete valid configuration', () => {
    const config = parseEnvConfig(validEnv());
    expect(config.FRONTEND_URL).toBe('http://localhost:3000');
    expect(config.DATABASE_URL).toContain('postgresql://');
    expect(config.RESEND_API_KEY).toBe('re_test_key');
    expect(isR2ObjectStorageConfigured(config)).toBe(true);
  });

  it('fails when a required field is missing', () => {
    const env = validEnv();
    delete env.DATABASE_URL;
    expect(() => parseEnvConfig(env)).toThrow(/DATABASE_URL/);
  });

  it('fails when RESEND_API_KEY is missing', () => {
    const env = validEnv();
    delete env.RESEND_API_KEY;
    expect(() => parseEnvConfig(env)).toThrow(/RESEND_API_KEY/);
  });

  it('fails when any R2 field is missing', () => {
    const env = validEnv();
    delete env.R2_BUCKET;
    expect(() => parseEnvConfig(env)).toThrow(/R2_BUCKET/);
  });

  it('fails on invalid URL format', () => {
    expect(() => parseEnvConfig(validEnv({ FRONTEND_URL: 'not-a-url' }))).toThrow(/FRONTEND_URL/);
    expect(() => parseEnvConfig(validEnv({ REDIS_URL: 'not-a-url' }))).toThrow(/REDIS_URL/);
  });

  it('fails on invalid email format', () => {
    expect(() => parseEnvConfig(validEnv({ MAIL_FROM_ADDRESS: 'not-an-email' }))).toThrow(/MAIL_FROM_ADDRESS/);
  });

  it('fails when BETTER_AUTH_SECRET is too short', () => {
    expect(() => parseEnvConfig(validEnv({ BETTER_AUTH_SECRET: 'short' }))).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('fails when R2 fields are empty strings', () => {
    expect(() =>
      parseEnvConfig(
        validEnv({
          R2_ACCOUNT_ID: '',
          R2_BUCKET: '',
          R2_ACCESS_KEY_ID: '',
          R2_SECRET_ACCESS_KEY: '',
        }),
      ),
    ).toThrow(/R2_/);
  });

  it('treats empty RESEND_API_KEY as missing', () => {
    expect(() => parseEnvConfig(validEnv({ RESEND_API_KEY: '' }))).toThrow(/RESEND_API_KEY/);
  });

  it('does not leak secret values in validation errors', () => {
    const secret = 'super-secret-password-value-xyz';
    try {
      parseEnvConfig(validEnv({ BETTER_AUTH_SECRET: 'short' }));
      expect.unreachable('expected parseEnvConfig to throw');
    } catch (error) {
      const message = formatEnvValidationError(error);
      expect(message).not.toContain('test-secret');
      expect(message).toMatch(/BETTER_AUTH_SECRET/);
      expect(message).toMatch(/value omitted/);
    }

    try {
      parseEnvConfig(validEnv({ DATABASE_URL: `not-a-url-with-${secret}` }));
      expect.unreachable('expected parseEnvConfig to throw');
    } catch (error) {
      const message = formatEnvValidationError(error);
      expect(message).not.toContain(secret);
      expect(message).toMatch(/DATABASE_URL/);
    }
  });

  it('API and Worker share the same Env shape (typed config)', () => {
    const config: Env = parseEnvConfig(validEnv());
    // Same model consumed by index.ts (API) and worker.ts via @/lib/env
    expect(config).toMatchObject({
      DATABASE_URL: expect.any(String),
      REDIS_URL: expect.any(String),
      FRONTEND_URL: expect.any(String),
      BETTER_AUTH_SECRET: expect.any(String),
      LLM_CONFIG_ENCRYPTION_KEY: expect.any(String),
      MAIL_FROM_ADDRESS: expect.any(String),
      MAIL_FROM_NAME: expect.any(String),
      RESEND_API_KEY: expect.any(String),
      R2_ACCOUNT_ID: expect.any(String),
      R2_BUCKET: expect.any(String),
      R2_ACCESS_KEY_ID: expect.any(String),
      R2_SECRET_ACCESS_KEY: expect.any(String),
    });
  });
});

describe('loadEnvConfig', () => {
  it('does not let .env override keys already set on processEnv', () => {
    const distinctiveUrl = 'postgresql://explicit-host:5432/explicit_db_priority_marker';
    const processEnv = validEnv({
      DATABASE_URL: distinctiveUrl,
      // Keep VITEST unset so applyTestDatabaseEnv does not rewrite DATABASE_URL.
    });

    const config = loadEnvConfig(processEnv);
    expect(config.DATABASE_URL).toBe(distinctiveUrl);
    expect(processEnv.DATABASE_URL).toBe(distinctiveUrl);
  });

  it('fails when VITEST=true and TEST_DATABASE_URL is missing', () => {
    // Own the key so dotenv cannot fill it from .env.test (override: false).
    const processEnv = validEnv({
      VITEST: 'true',
      TEST_DATABASE_URL: undefined,
    });

    expect(() => loadEnvConfig(processEnv)).toThrow(/TEST_DATABASE_URL is required/);
  });

  it('fails when VITEST=true and TEST_DATABASE_URL is not gloaming_test', () => {
    const processEnv = validEnv({
      VITEST: 'true',
      TEST_DATABASE_URL: 'postgresql://localhost:5432/gloaming_backend',
    });

    expect(() => loadEnvConfig(processEnv)).toThrow(/gloaming_test/);
  });

  it('pins DATABASE_URL to TEST_DATABASE_URL when VITEST=true', () => {
    const testUrl = 'postgresql://localhost:5432/gloaming_test';
    const processEnv = validEnv({
      VITEST: 'true',
      DATABASE_URL: 'postgresql://localhost:5432/should_be_overwritten',
      TEST_DATABASE_URL: testUrl,
    });

    const config = loadEnvConfig(processEnv);
    expect(config.DATABASE_URL).toBe(testUrl);
    expect(processEnv.DATABASE_URL).toBe(testUrl);
  });
});
