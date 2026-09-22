import { eq } from 'drizzle-orm';

import { readingState as readingStateTable } from '@gloaming/db';
import { calendarDateInTimeZone } from '@gloaming/shared/reading-history';

import { insertReadingDays } from '@/domains/reading/history/heartbeat';
import { db } from '@/infra/db';

function pushShanghaiDates(target: Set<string>, ...values: Array<Date | null | undefined>): void {
  for (const value of values) {
    if (value) {
      target.add(calendarDateInTimeZone(value));
    }
  }
}

export async function backfillReadingDays(userId: string): Promise<{ candidateDays: number; insertedDays: number }> {
  const dates = new Set<string>();

  const stateRows = await db
    .select({
      createdAt: readingStateTable.createdAt,
      lastReadAt: readingStateTable.lastReadAt,
      completedAt: readingStateTable.completedAt,
    })
    .from(readingStateTable)
    .where(eq(readingStateTable.userId, userId));
  for (const row of stateRows) {
    pushShanghaiDates(dates, row.createdAt, row.lastReadAt, row.completedAt);
  }

  return {
    candidateDays: dates.size,
    insertedDays: await insertReadingDays(userId, dates),
  };
}
