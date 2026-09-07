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

function databaseNameFromUrl(url: string): string {
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, '').split('/')[0];
  if (!name) {
    throw new Error(`Cannot parse database name from DATABASE_URL: ${url}`);
  }
  return decodeURIComponent(name);
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

  const dbName = databaseNameFromUrl(testUrl);
  if (dbName !== TEST_DATABASE_NAME) {
    delete process.env.DATABASE_URL;
    throw new Error(
      `TEST_DATABASE_URL must point exactly at the test database "${TEST_DATABASE_NAME}", got "${dbName}".`,
    );
  }
}

assertTestDatabaseIsolation();

/** First signup on an empty DB becomes admin (auth bootstrap). Pre-seed so test signups get `user`. */
async function consumeBootstrapAdminSlot(): Promise<void> {
  const { count } = await import('drizzle-orm');
  const { user: userTable } = await import('@gloaming/db');
  const { AUTH_ADMIN_ROLE } = await import('@gloaming/shared/auth');
  const { db } = await import('@/db');

  const [row] = await db.select({ value: count() }).from(userTable);
  if (Number(row?.value ?? 0) > 0) {
    return;
  }

  await db.insert(userTable).values({
    id: 'vitest-bootstrap-admin',
    name: 'Vitest Bootstrap',
    email: 'vitest-bootstrap-admin@example.com',
    emailVerified: true,
    username: 'vitest_bootstrap_admin',
    displayUsername: 'vitest_bootstrap_admin',
    role: AUTH_ADMIN_ROLE,
  });
}

await consumeBootstrapAdminSlot();
