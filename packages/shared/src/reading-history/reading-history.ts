import { z } from 'zod';

import { READING_STATE_STATUSES } from '../reader/index.ts';

/** Calendar day for reading activity (history heatmap). */
export const READING_DAY_TIME_ZONE = 'Asia/Shanghai';

export function calendarDateInTimeZone(now = new Date(), timeZone = READING_DAY_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

/** Soft daily ceiling for engaged seconds (8h) — anti-runaway. */
export const READING_DAY_ENGAGED_SECONDS_CAP = 8 * 60 * 60;

/** One Shanghai day with engaged reading time (heatmap source). */
export const readingHistoryActivityDaySchema = z.object({
  date: calendarDateSchema,
  engagedSeconds: z.number().int().positive().max(READING_DAY_ENGAGED_SECONDS_CAP),
});

export type ReadingHistoryActivityDay = z.infer<typeof readingHistoryActivityDaySchema>;

/** Works the user has opened (in progress) or finished — history list rows. */
export const readingHistoryWorkSchema = z.object({
  workId: z.string().min(1),
  title: z.string().min(1),
  author: z.string(),
  coverAssetId: z.string().nullable(),
  status: z.enum(READING_STATE_STATUSES),
  /** Shanghai calendar day: completedAt when finished, else lastReadAt. */
  date: calendarDateSchema,
});

export type ReadingHistoryWork = z.infer<typeof readingHistoryWorkSchema>;

export const readingHistorySummarySchema = z.object({
  consecutiveDays: z.number().int().min(0),
  readingDays: z.number().int().min(0),
  completedWorks: z.number().int().min(0),
  lookedUpWords: z.number().int().min(0),
});

export type ReadingHistorySummary = z.infer<typeof readingHistorySummarySchema>;

export const readingHistoryDataSchema = z.object({
  today: calendarDateSchema,
  activity: z.array(readingHistoryActivityDaySchema),
  works: z.array(readingHistoryWorkSchema),
  portrait: readingHistorySummarySchema,
});

export type ReadingHistoryData = z.infer<typeof readingHistoryDataSchema>;

/** Reader engaged-time heartbeat interval (client). */
export const READING_HEARTBEAT_INTERVAL_MS = 30_000 as const;

/**
 * Max seconds credited per heartbeat request (interval + unload remainder jitter).
 * Client should not send more; server clamps.
 */
export const READING_HEARTBEAT_MAX_CREDIT_SECONDS = 45 as const;

export const readingHeartbeatBodySchema = z.object({
  seconds: z.number().int().positive().max(READING_HEARTBEAT_MAX_CREDIT_SECONDS),
});

export type ReadingHeartbeatBody = z.infer<typeof readingHeartbeatBodySchema>;

export const readingHeartbeatResultSchema = z.object({
  localDate: calendarDateSchema,
  engagedSeconds: z.number().int().min(0).max(READING_DAY_ENGAGED_SECONDS_CAP),
});

export type ReadingHeartbeatResult = z.infer<typeof readingHeartbeatResultSchema>;
