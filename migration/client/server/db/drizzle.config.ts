import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'drizzle-kit';

const root = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(root, '../..');
config({ path: resolve(clientRoot, '.env'), override: false });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required (set in migration/client/.env)');
}

export default defineConfig({
  schema: './schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
});
