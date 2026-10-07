import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/infra/db';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', '..');
const MIGRATION_PATH = path.join(repoRoot, 'packages', 'db', 'migrations', '0042_discovery_source_metadata.sql');

let client: pg.Client;
const createdSourceIds: string[] = [];

/** Walks the wrapped Drizzle -> pg error chain so the PG constraint name is asserted, not just the SQL wrapper. */
function errorChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    parts.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(' | ');
}

async function expectConstraintViolation(run: () => Promise<unknown>, constraintName: string): Promise<void> {
  let error: unknown = null;
  try {
    await run();
  } catch (thrown) {
    error = thrown;
  }
  expect(error).not.toBeNull();
  expect(errorChain(error)).toContain(constraintName);
}

/** Inserts a DiscoverySource owned by this test only; returns its id. */
async function createTestSource(sourceKey: string): Promise<string> {
  const id = randomUUID();
  createdSourceIds.push(id);
  await db.execute(
    sql`insert into "discovery_source" ("id", "source_key", "source_type") values (${id}, ${sourceKey}, ${'gutenberg_rdf'})`,
  );
  return id;
}

describe('DS-02 discovery schema on gloaming_test', () => {
  beforeAll(async () => {
    const connectionString = process.env.TEST_DATABASE_URL;
    expect(connectionString).toBeTruthy();
    expect(new URL(connectionString!).pathname).toBe('/gloaming_test');
    expect(new URL(connectionString!).hostname).toBe('127.0.0.1');
    client = new pg.Client({ connectionString });
    await client.connect();
  });

  afterAll(async () => {
    for (const sourceId of createdSourceIds) {
      await db.execute(sql`delete from "discovery_source" where "id" = ${sourceId}`);
    }
    await client?.end();
  });

  it('records migration 0042 as applied with a hash matching the migration file', async () => {
    const result = await client.query<{ hash: string }>(
      'select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1',
    );
    const expectedHash = createHash('sha256').update(fs.readFileSync(MIGRATION_PATH)).digest('hex');
    expect(result.rows[0]?.hash).toBe(expectedHash);
  });

  it('creates discovery_source and source_record tables', async () => {
    const result = await client.query<{ tableName: string }>(
      `select table_name as "tableName" from information_schema.tables
       where table_schema = 'public' and table_name in ('discovery_source', 'source_record') order by table_name`,
    );
    expect(result.rows.map((row) => row.tableName)).toEqual(['discovery_source', 'source_record']);
  });

  it('enforces the source_record -> discovery_source foreign key with cascade delete', async () => {
    const fk = await client.query<{ conname: string; confdeltype: string }>(
      `select c.conname, c.confdeltype
       from pg_constraint c join pg_class t on t.oid = c.conrelid
       where t.relname = 'source_record' and c.contype = 'f'`,
    );
    expect(fk.rows).toEqual([{ conname: 'source_record_source_id_discovery_source_id_fk', confdeltype: 'c' }]);

    await expectConstraintViolation(
      () =>
        db.execute(
          sql`insert into "source_record" ("id", "source_id", "external_id") values (${randomUUID()}, ${randomUUID()}, ${'fk-orphan'})`,
        ),
      'source_record_source_id_discovery_source_id_fk',
    );
  });

  it('enforces the unique (source_id, external_id) constraint', async () => {
    const unique = await client.query<{ conname: string; columns: string }>(
      `select c.conname, string_agg(a.attname, ',' order by array_position(c.conkey, a.attnum)) as columns
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       join pg_attribute a on a.attrelid = t.oid and a.attnum = any (c.conkey)
       where t.relname = 'source_record' and c.contype = 'u'
       group by c.conname`,
    );
    expect(unique.rows).toEqual([{ conname: 'source_record_source_external_uidx', columns: 'source_id,external_id' }]);

    const sourceId = await createTestSource(`schema_uidx_${randomUUID()}`);
    await db.execute(
      sql`insert into "source_record" ("id", "source_id", "external_id") values (${randomUUID()}, ${sourceId}, ${'dup-1'})`,
    );
    await expectConstraintViolation(
      () =>
        db.execute(
          sql`insert into "source_record" ("id", "source_id", "external_id") values (${randomUUID()}, ${sourceId}, ${'dup-1'})`,
        ),
      'source_record_source_external_uidx',
    );
  });

  it('enforces the discovery_source and source_record check constraints', async () => {
    const checks = await client.query<{ conname: string }>(
      `select c.conname from pg_constraint c join pg_class t on t.oid = c.conrelid
       where c.contype = 'c' and t.relname in ('discovery_source', 'source_record') order by c.conname`,
    );
    expect(checks.rows.map((row) => row.conname)).toEqual([
      'discovery_source_key_nonempty_chk',
      'discovery_source_sync_status_check',
      'source_record_availability_check',
      'source_record_external_id_nonempty_chk',
    ]);

    const sourceId = await createTestSource(`schema_chk_${randomUUID()}`);
    await expectConstraintViolation(
      () =>
        db.execute(
          sql`insert into "discovery_source" ("id", "source_key", "source_type") values (${randomUUID()}, ${''}, ${'gutenberg_rdf'})`,
        ),
      'discovery_source_key_nonempty_chk',
    );
    await expectConstraintViolation(
      () =>
        db.execute(
          sql`insert into "discovery_source" ("id", "source_key", "source_type", "sync_status") values (${randomUUID()}, ${`bad_status_${randomUUID()}`}, ${'gutenberg_rdf'}, ${'bogus'})`,
        ),
      'discovery_source_sync_status_check',
    );
    await expectConstraintViolation(
      () =>
        db.execute(
          sql`insert into "source_record" ("id", "source_id", "external_id") values (${randomUUID()}, ${sourceId}, ${''})`,
        ),
      'source_record_external_id_nonempty_chk',
    );
    await expectConstraintViolation(
      () =>
        db.execute(
          sql`insert into "source_record" ("id", "source_id", "external_id", "availability") values (${randomUUID()}, ${sourceId}, ${'bad-availability'}, ${'bogus'})`,
        ),
      'source_record_availability_check',
    );
  });

  it('creates the expected supporting indexes', async () => {
    const indexes = await client.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public' and tablename in ('discovery_source', 'source_record')`,
    );
    const names = indexes.rows.map((row) => row.indexname);
    for (const expected of [
      'discovery_source_key_uidx',
      'source_record_source_external_uidx',
      'source_record_source_idx',
      'source_record_source_availability_idx',
      'source_record_languages_gin_idx',
      'source_record_last_seen_idx',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('cascades source_record deletion when the owning source is deleted', async () => {
    const sourceKey = `schema_cascade_${randomUUID()}`;
    const sourceId = await createTestSource(sourceKey);
    const recordId = randomUUID();
    await db.execute(
      sql`insert into "source_record" ("id", "source_id", "external_id") values (${recordId}, ${sourceId}, ${'cascade-1'})`,
    );

    await db.execute(sql`delete from "discovery_source" where "id" = ${sourceId}`);
    const remaining = await db.execute<{ id: string }>(sql`select "id" from "source_record" where "id" = ${recordId}`);
    expect(remaining.rows).toHaveLength(0);
    createdSourceIds.splice(createdSourceIds.indexOf(sourceId), 1);
  });
});
