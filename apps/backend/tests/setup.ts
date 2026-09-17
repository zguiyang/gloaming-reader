/**
 * Vitest global setup — enforces test DB isolation before any spec imports `@/db`.
 * Loads `apps/backend/.env.test` (see `.env.test.example`).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

loadDotenv({ path: path.join(backendRoot, '.env'), override: false });
loadDotenv({ path: path.join(backendRoot, '.env.test'), override: true });

const TEST_DATABASE_NAME = 'gloaming_test';
const TEST_REDIS_DB = 1;

function databaseNameFromUrl(url: string): string {
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, '').split('/')[0];
  if (!name) {
    throw new Error(`Cannot parse database name from DATABASE_URL: ${url}`);
  }
  return decodeURIComponent(name);
}

/** Keep all Vitest Redis state away from the development Worker Redis database. */
function testRedisUrlFrom(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${TEST_REDIS_DB}`;
  return parsed.toString();
}

function assertTestDatabaseIsolation(): void {
  const testUrl = process.env.TEST_DATABASE_URL?.trim();
  if (!testUrl) {
    delete process.env.DATABASE_URL;
    throw new Error(
      [
        'TEST_DATABASE_URL is required for backend tests.',
        'Copy apps/backend/.env.test.example → apps/backend/.env.test, create database gloaming_test, then run: pnpm db:migrate:test',
      ].join(' '),
    );
  }

  process.env.DATABASE_URL = testUrl;

  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    throw new Error('REDIS_URL is required for backend tests.');
  }
  process.env.REDIS_URL = testRedisUrlFrom(redisUrl);

  const dbName = databaseNameFromUrl(testUrl);
  if (dbName !== TEST_DATABASE_NAME) {
    delete process.env.DATABASE_URL;
    throw new Error(
      `TEST_DATABASE_URL must point exactly at the test database "${TEST_DATABASE_NAME}", got "${dbName}".`,
    );
  }
}

assertTestDatabaseIsolation();
