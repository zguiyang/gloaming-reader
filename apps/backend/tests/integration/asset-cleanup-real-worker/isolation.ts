import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';

import type { IsolatedEnv } from './types';

export const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const envPath = resolve(backendRoot, '.env');
export const testEnvPath = resolve(backendRoot, '.env.test');

function loadEnvFile(path: string, override: boolean): Record<string, string> {
  const collected: Record<string, string> = {};
  loadDotenv({
    path,
    override,
    processEnv: collected as NodeJS.ProcessEnv & Record<string, string>,
  });
  return collected;
}

export function redactRedis(url: string): { host: string; port: string; db: string } {
  const parsed = new URL(url);
  const db = (parsed.pathname.replace(/^\//, '') || '0').split('/')[0] || '0';
  return { host: parsed.hostname, port: String(parsed.port || '6379'), db };
}

function withRedisDb(url: string, dbIndex: number): string {
  const parsed = new URL(url);
  parsed.pathname = `/${dbIndex}`;
  return parsed.toString();
}

function assertIsolationOrThrow(config: {
  databaseUrl: string;
  redisUrl: string;
  s3Bucket: string;
  s3Endpoint: string;
}): void {
  const dbName = new URL(config.databaseUrl).pathname.replace(/^\//, '').split('/')[0];
  if (dbName !== 'gloaming_test') {
    throw new Error(`BLOCKED: DATABASE_URL must target gloaming_test, got ${dbName}`);
  }
  if (config.s3Bucket === 'gloaming-development') {
    throw new Error('BLOCKED: S3_BUCKET must not be gloaming-development');
  }
  const redis = redactRedis(config.redisUrl);
  if (redis.db === '0') {
    throw new Error('BLOCKED: test Redis DB index is 0 (conflicts with development Worker)');
  }
  const endpointHost = new URL(config.s3Endpoint).hostname;
  if (!endpointHost) {
    throw new Error('BLOCKED: S3_ENDPOINT host missing');
  }
}

/** Apply isolation env before any app module import. */
export function applyIsolatedEnv(): IsolatedEnv {
  const fromDotenv = loadEnvFile(envPath, false);
  const fromTest = loadEnvFile(testEnvPath, true);
  const merged = { ...fromDotenv, ...fromTest };

  const testDatabaseUrl = merged.TEST_DATABASE_URL?.trim();
  if (!testDatabaseUrl) {
    throw new Error('BLOCKED: TEST_DATABASE_URL missing in .env.test');
  }

  const redisBase = merged.REDIS_URL?.trim();
  if (!redisBase) {
    throw new Error('BLOCKED: REDIS_URL missing in .env.test');
  }

  const isolatedRedis = withRedisDb(redisBase, 1);
  const s3Bucket = merged.S3_BUCKET?.trim();
  const s3Endpoint = merged.S3_ENDPOINT?.trim();
  if (!s3Bucket || !s3Endpoint) {
    throw new Error('BLOCKED: S3_BUCKET / S3_ENDPOINT missing in .env.test');
  }

  const nextEnv: Record<string, string> = {
    ...merged,
    DATABASE_URL: testDatabaseUrl,
    REDIS_URL: isolatedRedis,
    NODE_ENV: 'test',
    S3_BUCKET: s3Bucket,
    S3_ENDPOINT: s3Endpoint,
  };
  delete nextEnv.VITEST;

  for (const [key, value] of Object.entries(nextEnv)) {
    process.env[key] = value;
  }
  delete process.env.VITEST;

  assertIsolationOrThrow({
    databaseUrl: testDatabaseUrl,
    redisUrl: isolatedRedis,
    s3Bucket,
    s3Endpoint,
  });

  return {
    databaseUrl: testDatabaseUrl,
    redisUrl: isolatedRedis,
    s3Bucket,
    s3Endpoint,
    s3EndpointHost: new URL(s3Endpoint).hostname,
    queueName: 'gloaming-asset-cleanup',
  };
}
