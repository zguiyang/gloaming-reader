import { and, asc, count, desc, eq, gt, sql } from 'drizzle-orm';

import {
  conversation as conversationTable,
  conversationMessage as conversationMessageTable,
  readingDay as readingDayTable,
  readingState as readingStateTable,
  readingWork as readingWorkTable,
} from '@gloaming/db';
import type { ReadingStateStatus } from '@gloaming/shared/reader';
import type { ReadingHistoryData, ReadingHistorySummary, ReadingHistoryWork } from '@gloaming/shared/reading-history';
import { calendarDateInTimeZone } from '@gloaming/shared/reading-history';

import type { WorkReadActor } from '@/domains/works/access';
import { canReadWorkRow } from '@/domains/works/access';
import { db } from '@/infra/db';

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

async function listWorks(actor: WorkReadActor, userId: string): Promise<ReadingHistoryWork[]> {
  const rows = await db
    .select({
      status: readingStateTable.status,
      completedAt: readingStateTable.completedAt,
      lastReadAt: readingStateTable.lastReadAt,
      title: readingWorkTable.title,
      author: readingWorkTable.author,
      coverAssetId: readingWorkTable.coverAssetId,
      workId: readingWorkTable.id,
      ownerUserId: readingWorkTable.ownerUserId,
      visibility: readingWorkTable.visibility,
      publishedAt: readingWorkTable.publishedAt,
    })
    .from(readingStateTable)
    .innerJoin(readingWorkTable, eq(readingWorkTable.id, readingStateTable.workId))
    .where(eq(readingStateTable.userId, userId))
    .orderBy(desc(readingStateTable.lastReadAt), asc(readingWorkTable.title));

  const works = rows.flatMap((row): ReadingHistoryWork[] => {
    if (!canReadWorkRow(actor, row)) {
      return [];
    }
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

export async function getReadingHistory(actor: WorkReadActor, userId: string): Promise<ReadingHistoryData> {
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
    works: await listWorks(actor, userId),
    portrait,
  };
}
