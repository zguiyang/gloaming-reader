import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { eq, inArray, sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readingWork } from '@gloaming/db';

import { db } from '@/infra/db';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', '..');
const MIGRATION_0042_PATH = path.join(repoRoot, 'packages', 'db', 'migrations', '0042_discovery_source_metadata.sql');
const MIGRATION_0043_PATH = path.join(repoRoot, 'packages', 'db', 'migrations', '0043_brave_exodus.sql');

let client: pg.Client;
const createdSourceIds: string[] = [];
const createdWorkIds: string[] = [];

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

/** Inserts an ownerless ReadingWork owned by this test only; returns its id. */
async function createTestWork(): Promise<string> {
  const id = randomUUID();
  createdWorkIds.push(id);
  await db.execute(sql`insert into "reading_work" ("id", "title") values (${id}, ${'ds-schema-work'})`);
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
    if (createdWorkIds.length) {
      await db.delete(readingWork).where(inArray(readingWork.id, createdWorkIds));
    }
    await client?.end();
  });

  it('records migrations 0042 and 0043 as applied with hashes matching the migration files', async () => {
    const result = await client.query<{ hash: string }>('select hash from drizzle.__drizzle_migrations');
    const applied = new Set(result.rows.map((row) => row.hash));
    const expected0042 = createHash('sha256').update(fs.readFileSync(MIGRATION_0042_PATH)).digest('hex');
    const expected0043 = createHash('sha256').update(fs.readFileSync(MIGRATION_0043_PATH)).digest('hex');
    expect(applied.has(expected0042)).toBe(true);
    expect(applied.has(expected0043)).toBe(true);
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
       where t.relname = 'source_record' and c.contype = 'f'
         and c.conname = 'source_record_source_id_discovery_source_id_fk'`,
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
         and c.conname = 'source_record_source_external_uidx'
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
      'source_record_materialization_status_check',
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
    await expectConstraintViolation(
      () =>
        db.execute(
          sql`insert into "source_record" ("id", "source_id", "external_id", "materialization_status") values (${randomUUID()}, ${sourceId}, ${'bad-materialization'}, ${'bogus'})`,
        ),
      'source_record_materialization_status_check',
    );
  });

  it('links at most one ReadingWork per source_record with an ownerless materialization status column', async () => {
    const column = await client.query<{ isNullable: string; columnDefault: string }>(
      `select is_nullable as "isNullable", column_default as "columnDefault"
       from information_schema.columns
       where table_name = 'source_record' and column_name = 'materialization_status'`,
    );
    expect(column.rows).toEqual([{ isNullable: 'NO', columnDefault: "'not_materialized'::text" }]);

    const workFk = await client.query<{ conname: string; confdeltype: string }>(
      `select c.conname, c.confdeltype
       from pg_constraint c join pg_class t on t.oid = c.conrelid
       where t.relname = 'source_record' and c.contype = 'f'
         and c.conname = 'source_record_work_id_reading_work_id_fk'`,
    );
    expect(workFk.rows).toEqual([{ conname: 'source_record_work_id_reading_work_id_fk', confdeltype: 'n' }]);

    const workUnique = await client.query<{ conname: string; columns: string }>(
      `select c.conname, string_agg(a.attname, ',' order by array_position(c.conkey, a.attnum)) as columns
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       join pg_attribute a on a.attrelid = t.oid and a.attnum = any (c.conkey)
       where t.relname = 'source_record' and c.contype = 'u' and c.conname = 'source_record_work_uidx'
       group by c.conname`,
    );
    expect(workUnique.rows).toEqual([{ conname: 'source_record_work_uidx', columns: 'work_id' }]);

    const workId = await createTestWork();
    const sourceId = await createTestSource(`schema_work_${randomUUID()}`);
    const firstId = randomUUID();
    await db.execute(
      sql`insert into "source_record" ("id", "source_id", "external_id", "work_id", "materialization_status") values (${firstId}, ${sourceId}, ${'work-link-1'}, ${workId}, ${'processing'})`,
    );
    await expectConstraintViolation(
      () =>
        db.execute(
          sql`insert into "source_record" ("id", "source_id", "external_id", "work_id") values (${randomUUID()}, ${sourceId}, ${'work-link-2'}, ${workId})`,
        ),
      'source_record_work_uidx',
    );

    // Deleting the Work only unlinks the SourceRecord (ON DELETE SET NULL).
    await db.delete(readingWork).where(eq(readingWork.id, workId));
    createdWorkIds.splice(createdWorkIds.indexOf(workId), 1);
    const remaining = await db.execute<{ workId: string | null }>(
      sql`select "work_id" as "workId" from "source_record" where "id" = ${firstId}`,
    );
    expect(remaining.rows[0]?.workId).toBeNull();
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
