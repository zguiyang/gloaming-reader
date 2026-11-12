import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'drizzle-kit';

const root = dirname(fileURLToPath(import.meta.url));
// Shell-exported DATABASE_URL (e.g. db:migrate:test) must not be overwritten by .env.
config({ path: resolve(root, '../../apps/backend/.env'), override: false });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required (set in apps/backend/.env)');
}

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
});
