import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { readingWork, sourceRecord } from '@gloaming/db/schema';

/**
 * Pure Drizzle-metadata assertions for the SourceRecord → ReadingWork link.
 * No database is touched here; the SQL migration is verified separately.
 */
describe('source_record materialization schema model', () => {
  const config = getTableConfig(sourceRecord);
  const columns = new Map(config.columns.map((column) => [column.name, column]));

  it('adds a nullable work_id linked to reading_work with ON DELETE SET NULL', () => {
    const workId = columns.get('work_id');
    expect(workId).toBeDefined();
    expect(workId!.notNull).toBe(false);

    const fk = config.foreignKeys.find((key) => key.getName() === 'source_record_work_id_reading_work_id_fk');
    expect(fk).toBeDefined();
    expect(fk!.onDelete).toBe('set null');
    const reference = fk!.reference();
    expect(reference.foreignTable).toBe(readingWork);
    expect(reference.foreignColumns.map((column) => column.name)).toEqual(['id']);
    expect(reference.columns.map((column) => column.name)).toEqual(['work_id']);
  });

  it('defaults materialization_status to not_materialized with the allowed value check', () => {
    const status = columns.get('materialization_status');
    expect(status).toBeDefined();
    expect(status!.notNull).toBe(true);
    expect(status!.hasDefault).toBe(true);
    expect(String(status!.default)).toBe('not_materialized');

    expect(config.checks.map((check) => check.name)).toContain('source_record_materialization_status_check');
  });

  it('guarantees at most one SourceRecord per ReadingWork', () => {
    const unique = config.uniqueConstraints.find((constraint) => constraint.name === 'source_record_work_uidx');
    expect(unique).toBeDefined();
    expect(unique!.columns.map((column) => column.name)).toEqual(['work_id']);
  });
});
