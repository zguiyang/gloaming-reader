import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { sourceRecord, sourceRecordSaveIntent, user } from '@gloaming/db/schema';

/**
 * Pure Drizzle-metadata assertions for the SourceRecord Save intent table.
 * No database is touched here; the SQL migration is verified separately.
 */
describe('source_record_save_intent schema model', () => {
  const config = getTableConfig(sourceRecordSaveIntent);
  const columns = new Map(config.columns.map((column) => [column.name, column]));

  it('keys identity on (user_id, source_record_id) so repeats are idempotent', () => {
    const unique = config.uniqueConstraints.find(
      (constraint) => constraint.name === 'source_record_save_intent_user_record_uidx',
    );
    expect(unique).toBeDefined();
    expect(unique!.columns.map((column) => column.name)).toEqual(['user_id', 'source_record_id']);
  });

  it('cascades intents away with their user and SourceRecord', () => {
    const userFk = config.foreignKeys.find((key) =>
      key.getName().startsWith('source_record_save_intent_user_id_user_id_fk'),
    );
    expect(userFk).toBeDefined();
    expect(userFk!.onDelete).toBe('cascade');
    expect(userFk!.reference().foreignTable).toBe(user);

    const recordFk = config.foreignKeys.find((key) =>
      key.getName().startsWith('source_record_save_intent_source_record_id_source_record_id_fk'),
    );
    expect(recordFk).toBeDefined();
    expect(recordFk!.onDelete).toBe('cascade');
    expect(recordFk!.reference().foreignTable).toBe(sourceRecord);
  });

  it('defaults status to pending behind an allowed-value check', () => {
    const status = columns.get('status');
    expect(status).toBeDefined();
    expect(status!.notNull).toBe(true);
    expect(status!.hasDefault).toBe(true);
    expect(String(status!.default)).toBe('pending');
    expect(config.checks.map((check) => check.name)).toContain('source_record_save_intent_status_check');
  });

  it('keeps failure code/reason nullable and rejects empty failure codes', () => {
    expect(columns.get('failure_code')!.notNull).toBe(false);
    expect(columns.get('failure_reason')!.notNull).toBe(false);
    expect(config.checks.map((check) => check.name)).toContain('source_record_save_intent_failure_code_nonempty_chk');
  });
});
