import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE } from '@gloaming/i18n';

import {
  countHistoryActivityDays,
  engagedSecondsToActivityLevel,
  fitHistoryCalendarBlockSize,
  formatEngagedMinutesLabel,
  formatHistoryCalendarDate,
  HISTORY_ACTIVITY_MAX_LEVEL,
  HISTORY_CALENDAR_MIN_BLOCK_SIZE,
  historyCalendarWeekColumns,
  refineHistoryCalendarBlockSize,
  toHistoryActivityCalendarData,
} from './history-model';

describe('history-model activity calendar', () => {
  it('formats calendar dates in Chinese', () => {
    expect(formatHistoryCalendarDate('2026-01-15', DEFAULT_LOCALE)).toBe('2026年1月15日');
  });

  it('maps engaged seconds to heatmap levels with max depth at 15 minutes', () => {
    expect(engagedSecondsToActivityLevel(0)).toBe(0);
    expect(engagedSecondsToActivityLevel(1)).toBe(1);
    expect(engagedSecondsToActivityLevel(299)).toBe(1);
    expect(engagedSecondsToActivityLevel(300)).toBe(2);
    expect(engagedSecondsToActivityLevel(599)).toBe(2);
    expect(engagedSecondsToActivityLevel(600)).toBe(3);
    expect(engagedSecondsToActivityLevel(899)).toBe(3);
    expect(engagedSecondsToActivityLevel(900)).toBe(HISTORY_ACTIVITY_MAX_LEVEL);
    expect(engagedSecondsToActivityLevel(3600)).toBe(HISTORY_ACTIVITY_MAX_LEVEL);
  });

  it('formats engaged minutes for tooltips', () => {
    expect(formatEngagedMinutesLabel(30, DEFAULT_LOCALE)).toBe('约 1 分钟');
    expect(formatEngagedMinutesLabel(900, DEFAULT_LOCALE)).toBe('约 15 分钟');
  });

  it('counts week columns for the year window', () => {
    expect(historyCalendarWeekColumns('2026-09-01')).toBe(53);
  });

  it('fits block size without forcing overflow on wide cards', () => {
    expect(fitHistoryCalendarBlockSize(400)).toBe(HISTORY_CALENDAR_MIN_BLOCK_SIZE);
    const mid = fitHistoryCalendarBlockSize(800, historyCalendarWeekColumns('2026-09-01'));
    const wide = fitHistoryCalendarBlockSize(1200, historyCalendarWeekColumns('2026-09-01'));
    expect(mid).toBeGreaterThan(HISTORY_CALENDAR_MIN_BLOCK_SIZE);
    expect(wide).toBeGreaterThan(mid);
  });

  it('only shrinks when refining an overflowing render', () => {
    expect(refineHistoryCalendarBlockSize(1000, 800, 12)).toBe(12);
    expect(refineHistoryCalendarBlockSize(800, 1000, 15)).toBe(12);
    expect(refineHistoryCalendarBlockSize(400, 800, 12)).toBe(HISTORY_CALENDAR_MIN_BLOCK_SIZE);
  });

  it('anchors a year window and colors cells by engaged duration', () => {
    const data = toHistoryActivityCalendarData('2026-09-01', [
      { date: '2026-09-01', engagedSeconds: 900 },
      { date: '2026-08-30', engagedSeconds: 120 },
      { date: '2024-01-01', engagedSeconds: 600 },
    ]);

    expect(data[0]?.date).toBe('2025-09-02');
    expect(data.at(-1)?.date).toBe('2026-09-01');
    expect(data.find((day) => day.date === '2026-08-30')).toEqual({
      date: '2026-08-30',
      count: 120,
      level: 1,
    });
    expect(data.find((day) => day.date === '2026-09-01')).toEqual({
      date: '2026-09-01',
      count: 900,
      level: HISTORY_ACTIVITY_MAX_LEVEL,
    });
    expect(data.some((day) => day.date === '2024-01-01')).toBe(false);
    expect(
      countHistoryActivityDays(
        [
          { date: '2026-09-01', engagedSeconds: 30 },
          { date: '2024-01-01', engagedSeconds: 600 },
        ],
        '2026-09-01',
      ),
    ).toBe(1);
  });
});
