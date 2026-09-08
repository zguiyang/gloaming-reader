import { randomUUID } from 'node:crypto';

import { and, asc, count, desc, eq, gt, sql } from 'drizzle-orm';

import {
  conversation as conversationTable,
  conversationMessage as conversationMessageTable,
  readingDay as readingDayTable,
  readingState as readingStateTable,
  readingWork as readingWorkTable,
} from '@gloaming/db';
import type { ReadingStateStatus } from '@gloaming/shared/reader';
import type {
  ReadingHeartbeatResult,
  ReadingHistoryData,
  ReadingHistorySummary,
  ReadingHistoryWork,
} from '@gloaming/shared/reading-history';
import {
  calendarDateInTimeZone,
  READING_DAY_ENGAGED_SECONDS_CAP,
  READING_HEARTBEAT_MAX_CREDIT_SECONDS,
} from '@gloaming/shared/reading-history';

import { db } from '@/db';

function addCalendarDays(date: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error(`Invalid calendar date: ${date}`);
  }
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  const yy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(next.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function consecutiveReadingDays(today: string, dates: ReadonlySet<string>): number {
  let countDays = 0;
  let cursor = today;
  while (dates.has(cursor)) {
    countDays += 1;
    cursor = addCalendarDays(cursor, -1);
  }
  return countDays;
}

async function insertReadingDays(userId: string, dates: Iterable<string>): Promise<number> {
  const unique = [...new Set(dates)];
  if (unique.length === 0) {
    return 0;
  }
  const inserted = await db
    .insert(readingDayTable)
    .values(unique.map((localDate) => ({ id: randomUUID(), userId, localDate })))
    .onConflictDoNothing({ target: [readingDayTable.userId, readingDayTable.localDate] })
    .returning({ localDate: readingDayTable.localDate });
  return inserted.length;
}

export async function touchReadingDay(userId: string, now = new Date()): Promise<void> {
  await insertReadingDays(userId, [calendarDateInTimeZone(now)]);
}

/** Credit engaged reading seconds for the Shanghai calendar day (reader heartbeat). */
export async function recordReadingHeartbeat(
  userId: string,
  seconds: number,
  now = new Date(),
): Promise<ReadingHeartbeatResult> {
  const credit = Math.min(Math.max(0, Math.floor(seconds)), READING_HEARTBEAT_MAX_CREDIT_SECONDS);
  if (credit <= 0) {
    const localDate = calendarDateInTimeZone(now);
    const [row] = await db
      .select({ engagedSeconds: readingDayTable.engagedSeconds })
      .from(readingDayTable)
      .where(and(eq(readingDayTable.userId, userId), eq(readingDayTable.localDate, localDate)))
      .limit(1);
    return { localDate, engagedSeconds: Number(row?.engagedSeconds ?? 0) };
  }

  const localDate = calendarDateInTimeZone(now);
  await db
    .insert(readingDayTable)
    .values({
      id: randomUUID(),
      userId,
      localDate,
      engagedSeconds: credit,
    })
    .onConflictDoUpdate({
      target: [readingDayTable.userId, readingDayTable.localDate],
      set: {
        engagedSeconds: sql`least(${READING_DAY_ENGAGED_SECONDS_CAP}, ${readingDayTable.engagedSeconds} + ${credit})`,
      },
    });

  const [row] = await db
    .select({ engagedSeconds: readingDayTable.engagedSeconds })
    .from(readingDayTable)
    .where(and(eq(readingDayTable.userId, userId), eq(readingDayTable.localDate, localDate)))
    .limit(1);

  return {
    localDate,
    engagedSeconds: Number(row?.engagedSeconds ?? credit),
  };
}

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

async function countLookedUpWords(userId: string): Promise<number> {
  const [row] = await db
    .select({
      value: sql<number>`coalesce(count(distinct lower(trim(${conversationMessageTable.metadata}->>'selection'))), 0)`,
    })
    .from(conversationMessageTable)
    .innerJoin(conversationTable, eq(conversationTable.id, conversationMessageTable.conversationId))
    .where(
      and(
        eq(conversationTable.userId, userId),
        eq(conversationMessageTable.role, 'user'),
        sql`${conversationMessageTable.metadata}->>'actionId' = 'lookup'`,
        sql`nullif(trim(${conversationMessageTable.metadata}->>'selection'), '') is not null`,
      ),
    );
  return Number(row?.value ?? 0);
}

async function countCompletedWorks(userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(readingStateTable)
    .where(and(eq(readingStateTable.userId, userId), eq(readingStateTable.status, 'completed')));
  return Number(row?.value ?? 0);
}

async function listEngagedActivity(userId: string): Promise<ReadingHistoryData['activity']> {
  const rows = await db
    .select({
      localDate: readingDayTable.localDate,
      engagedSeconds: readingDayTable.engagedSeconds,
    })
    .from(readingDayTable)
    .where(and(eq(readingDayTable.userId, userId), gt(readingDayTable.engagedSeconds, 0)))
    .orderBy(asc(readingDayTable.localDate));

  return rows.map((row) => ({
    date: row.localDate,
    engagedSeconds: Number(row.engagedSeconds),
  }));
}

async function listWorks(userId: string): Promise<ReadingHistoryWork[]> {
  const rows = await db
    .select({
      status: readingStateTable.status,
      completedAt: readingStateTable.completedAt,
      lastReadAt: readingStateTable.lastReadAt,
      title: readingWorkTable.title,
      author: readingWorkTable.author,
      coverAssetId: readingWorkTable.coverAssetId,
      workId: readingWorkTable.id,
    })
    .from(readingStateTable)
    .innerJoin(readingWorkTable, eq(readingWorkTable.id, readingStateTable.workId))
    .where(eq(readingStateTable.userId, userId))
    .orderBy(desc(readingStateTable.lastReadAt), asc(readingWorkTable.title));

  const works = rows.flatMap((row): ReadingHistoryWork[] => {
    const status = row.status as ReadingStateStatus;
    if (status !== 'in_progress' && status !== 'completed') {
      return [];
    }
    const activityAt = status === 'completed' ? (row.completedAt ?? row.lastReadAt) : row.lastReadAt;
    return [
      {
        workId: row.workId,
        title: row.title,
        author: row.author,
        coverAssetId: row.coverAssetId,
        status,
        date: calendarDateInTimeZone(activityAt),
      },
    ];
  });

  return works.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
}

export async function getReadingHistory(userId: string): Promise<ReadingHistoryData> {
  const today = calendarDateInTimeZone();

  const activity = await listEngagedActivity(userId);
  const dateSet = new Set(activity.map((day) => day.date));

  const portrait: ReadingHistorySummary = {
    consecutiveDays: consecutiveReadingDays(today, dateSet),
    readingDays: activity.length,
    completedWorks: await countCompletedWorks(userId),
    lookedUpWords: await countLookedUpWords(userId),
  };

  return {
    today,
    activity,
    works: await listWorks(userId),
    portrait,
  };
}
