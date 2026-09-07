import { describe, expect, it } from 'vitest';

import {
  calendarDateInTimeZone,
  READING_HEARTBEAT_MAX_CREDIT_SECONDS,
  readingHeartbeatBodySchema,
  readingHistoryDataSchema,
} from './reading-history.ts';

const valid = {
  today: '2026-08-19',
  activity: [{ date: '2026-08-19', engagedSeconds: 900 }],
  works: [
    {
      workId: 'work_1',
      title: 'A Warm Current',
      author: 'Anon',
      coverAssetId: null,
      status: 'completed' as const,
      date: '2026-08-18',
    },
    {
      workId: 'work_2',
      title: 'Still Reading',
      author: '',
      coverAssetId: 'asset_1',
      status: 'in_progress' as const,
      date: '2026-08-19',
    },
  ],
  portrait: {
    consecutiveDays: 1,
    readingDays: 1,
    completedWorks: 1,
    lookedUpWords: 0,
  },
};

describe('reading-history api contracts', () => {
  it('formats a Shanghai calendar date as YYYY-MM-DD', () => {
    expect(calendarDateInTimeZone(new Date('2026-08-18T18:30:00.000Z'))).toBe('2026-08-19');
  });

  it('accepts a sparse duration snapshot with in-progress and completed works', () => {
    expect(readingHistoryDataSchema.parse(valid)).toEqual(valid);
  });

  it('rejects zero engaged seconds and malformed dates', () => {
    expect(
      readingHistoryDataSchema.safeParse({
        ...valid,
        activity: [{ date: '2026-08-19', engagedSeconds: 0 }],
      }).success,
    ).toBe(false);
    expect(
      readingHistoryDataSchema.safeParse({
        ...valid,
        today: '2026/08/19',
      }).success,
    ).toBe(false);
  });

  it('rejects works missing status or coverAssetId key', () => {
    expect(
      readingHistoryDataSchema.safeParse({
        ...valid,
        works: [{ workId: 'w', title: 'T', author: '', status: 'completed', date: '2026-08-18' }],
      }).success,
    ).toBe(false);
  });

  it('accepts heartbeat seconds within the credit ceiling', () => {
    expect(readingHeartbeatBodySchema.parse({ seconds: 30 })).toEqual({ seconds: 30 });
    expect(readingHeartbeatBodySchema.safeParse({ seconds: READING_HEARTBEAT_MAX_CREDIT_SECONDS + 1 }).success).toBe(
      false,
    );
  });
});
