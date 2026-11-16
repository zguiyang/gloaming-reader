import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '@/server/db/schema';

import { commonEnv } from '@/server/infra/config/env-common';

const pool = new Pool({
  connectionString: commonEnv.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const db = drizzle(pool, { schema });
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Bounded dependency probe used by readiness and runtime boot. */
export async function dbPing(): Promise<void> {
  await pool.query('SELECT 1');
}
