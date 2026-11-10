import { randomUUID } from 'node:crypto';

import { and, eq, lt, sql } from 'drizzle-orm';

import { readingDay as readingDayTable, readingHeartbeat as readingHeartbeatTable } from '@gloaming/db';
import type { ReadingHeartbeatBody, ReadingHeartbeatResult } from '@gloaming/shared/reading-history';
import {
  calendarDateInTimeZone,
  READING_DAY_ENGAGED_SECONDS_CAP,
  READING_HEARTBEAT_MAX_CREDIT_SECONDS,
} from '@gloaming/shared/reading-history';

import { db } from '@/infra/db';

const READING_HEARTBEAT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export async function insertReadingDays(userId: string, dates: Iterable<string>): Promise<number> {
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
  input: ReadingHeartbeatBody,
  now = new Date(),
): Promise<ReadingHeartbeatResult> {
  const credit = Math.min(Math.max(0, Math.floor(input.seconds)), READING_HEARTBEAT_MAX_CREDIT_SECONDS);
  const localDate = calendarDateInTimeZone(now);
  if (credit <= 0) {
    const [row] = await db
      .select({ engagedSeconds: readingDayTable.engagedSeconds })
      .from(readingDayTable)
      .where(and(eq(readingDayTable.userId, userId), eq(readingDayTable.localDate, localDate)))
      .limit(1);
    return { localDate, engagedSeconds: Number(row?.engagedSeconds ?? 0) };
  }

  return db.transaction(async (tx) => {
    // Keep the dedupe table bounded without relying on a second worker system.
    await tx
      .delete(readingHeartbeatTable)
      .where(lt(readingHeartbeatTable.createdAt, new Date(now.getTime() - READING_HEARTBEAT_RETENTION_MS)));

    const [accepted] = await tx
      .insert(readingHeartbeatTable)
      .values({
        id: randomUUID(),
        userId,
        sessionId: input.sessionId,
        sequenceNumber: input.sequenceNumber,
        seconds: credit,
        localDate,
      })
      .onConflictDoNothing({
        target: [readingHeartbeatTable.userId, readingHeartbeatTable.sessionId, readingHeartbeatTable.sequenceNumber],
      })
      .returning({ localDate: readingHeartbeatTable.localDate, seconds: readingHeartbeatTable.seconds });

    let effectiveDate = accepted?.localDate ?? localDate;
    if (!accepted) {
      const [duplicate] = await tx
        .select({ localDate: readingHeartbeatTable.localDate })
        .from(readingHeartbeatTable)
        .where(
          and(
            eq(readingHeartbeatTable.userId, userId),
            eq(readingHeartbeatTable.sessionId, input.sessionId),
            eq(readingHeartbeatTable.sequenceNumber, input.sequenceNumber),
          ),
        )
        .limit(1);
      if (duplicate) {
        effectiveDate = duplicate.localDate;
      }
    }
    if (accepted) {
      await tx
        .insert(readingDayTable)
        .values({
          id: randomUUID(),
          userId,
          localDate: effectiveDate,
          engagedSeconds: accepted.seconds,
        })
        .onConflictDoUpdate({
          target: [readingDayTable.userId, readingDayTable.localDate],
          set: {
            engagedSeconds: sql`least(${READING_DAY_ENGAGED_SECONDS_CAP}, ${readingDayTable.engagedSeconds} + ${accepted.seconds})`,
          },
        });
    }

    const [row] = await tx
      .select({ engagedSeconds: readingDayTable.engagedSeconds })
      .from(readingDayTable)
      .where(and(eq(readingDayTable.userId, userId), eq(readingDayTable.localDate, effectiveDate)))
      .limit(1);

    return {
      localDate: effectiveDate,
      engagedSeconds: Number(row?.engagedSeconds ?? 0),
    };
  });
}
