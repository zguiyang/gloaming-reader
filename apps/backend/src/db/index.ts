import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '@gloaming/db/schema';

import { commonEnv } from '@/lib/env-common';
import { dbLogger } from '@/lib/logger';

dbLogger.info('Connecting to PostgreSQL...');

const pool = new Pool({
  connectionString: commonEnv.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const db = drizzle(pool, { schema });

/** Bounded dependency probe used by the readiness endpoint. */
export async function dbPing(): Promise<void> {
  await pool.query('SELECT 1');
}

dbLogger.info('Connected to PostgreSQL');
