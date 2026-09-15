'use client';

import 'react-activity-calendar/tooltips.css';

import { useTheme } from 'next-themes';
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityCalendar, type ThemeInput } from 'react-activity-calendar';

import { t } from '@gloaming/i18n';

import {
  countHistoryActivityDays,
  fitHistoryCalendarBlockSize,
  formatEngagedMinutesLabel,
  formatHistoryCalendarDate,
  getHistoryMonthLabels,
  getHistoryWeekdayLabels,
  HISTORY_ACTIVITY_MAX_LEVEL,
  HISTORY_CALENDAR_BLOCK_MARGIN,
  HISTORY_CALENDAR_FONT_SIZE,
  HISTORY_CALENDAR_MIN_BLOCK_SIZE,
  historyCalendarWeekColumns,
  historyCalendarWeekdayGutterPx,
  type HistoryViewModel,
  refineHistoryCalendarBlockSize,
  toHistoryActivityCalendarData,
} from '@/features/history/history-model';
import { useLocale } from '@/lib/locale-context';

/** Mix against theme surfaces — never literal white (breaks dark). */
const HISTORY_CALENDAR_THEME: ThemeInput = {
  light: [
    'color-mix(in oklab, var(--on-surface) 12%, var(--background))',
    'color-mix(in oklab, var(--primary) 35%, var(--background))',
    'color-mix(in oklab, var(--primary) 55%, var(--background))',
    'color-mix(in oklab, var(--primary) 75%, var(--background))',
    'var(--primary)',
  ],
  dark: [
    'color-mix(in oklab, var(--foreground) 10%, var(--background))',
    'color-mix(in oklab, var(--primary) 40%, var(--background))',
    'color-mix(in oklab, var(--primary) 60%, var(--background))',
    'color-mix(in oklab, var(--primary) 80%, var(--background))',
    'var(--primary)',
  ],
};

const LIBRARY_SCROLL_SELECTOR = '.react-activity-calendar-scroll-container';

type HistoryHeatmapProps = {
  today: string;
  activity: HistoryViewModel['activity'];
};

function scrollLibraryCalendarToLatest(root: HTMLElement): void {
  const scroller = root.querySelector(LIBRARY_SCROLL_SELECTOR);
  if (!(scroller instanceof HTMLElement)) {
    return;
  }
  if (scroller.scrollWidth <= scroller.clientWidth + 1) {
    return;
  }
  scroller.scrollLeft = scroller.scrollWidth - scroller.clientWidth;
}

export function HistoryHeatmap({ today, activity }: HistoryHeatmapProps) {
  const { locale } = useLocale();
  const data = toHistoryActivityCalendarData(today, activity);
  const daysInWindow = countHistoryActivityDays(activity, today);
  const calendarLabels = useMemo(
    () => ({
      months: getHistoryMonthLabels(locale),
      weekdays: getHistoryWeekdayLabels(locale),
      legend: {
        less: t(locale, 'content.history.legendLess'),
        more: t(locale, 'content.history.legendMore'),
      },
    }),
    [locale],
  );
  const frameRef = useRef<HTMLDivElement>(null);
  const [blockSize, setBlockSize] = useState<number>(HISTORY_CALENDAR_MIN_BLOCK_SIZE);
  const { resolvedTheme } = useTheme();
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const colorScheme = isClient && resolvedTheme === 'dark' ? 'dark' : 'light';

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === 'undefined') {
      return;
    }

    const syncFromWidth = () => {
      const available = frame.clientWidth;
      if (available <= 0) {
        return;
      }
      const next = fitHistoryCalendarBlockSize(
        available,
        historyCalendarWeekColumns(today),
        historyCalendarWeekdayGutterPx(HISTORY_CALENDAR_FONT_SIZE),
      );
      setBlockSize((current) => (current === next ? current : next));
    };

    syncFromWidth();
    const observer = new ResizeObserver(syncFromWidth);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [today, activity]);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }

    const scroller = frame.querySelector(LIBRARY_SCROLL_SELECTOR);
    if (!(scroller instanceof HTMLElement) || scroller.scrollWidth <= 0) {
      return;
    }

    if (scroller.scrollWidth > scroller.clientWidth + 1) {
      const shrunk = refineHistoryCalendarBlockSize(scroller.clientWidth, scroller.scrollWidth, blockSize);
      if (shrunk !== blockSize) {
        setBlockSize(shrunk);
        return;
      }
      scrollLibraryCalendarToLatest(frame);
      return;
    }

    scrollLibraryCalendarToLatest(frame);
  }, [blockSize, today, activity]);

  return (
    <section className="w-full space-y-4 md:space-y-6">
      <div className="hidden md:block">
        <h2 className="font-heading text-2xl font-semibold text-foreground">
          {t(locale, 'content.history.readingRecord')}
        </h2>
        <p className="mt-2 flex flex-wrap items-baseline gap-2">
          <span className="font-heading text-2xl font-semibold text-primary tabular-nums">
            {t(locale, 'content.history.readingDaysCount', { count: daysInWindow })}
          </span>
        </p>
      </div>

      <div className="md:hidden">
        <h2 className="border-b border-border/50 pb-2 text-sm font-medium tracking-wider text-muted-foreground uppercase">
          {t(locale, 'content.history.readingRecord')}
        </h2>
      </div>

      <div className="rounded-2xl border border-border/50 bg-card p-4 md:p-6">
        <div className="mb-4 md:hidden">
          <p className="text-sm text-foreground">{t(locale, 'content.history.distribution')}</p>
          <p className="text-[11px] font-medium text-muted-foreground">
            {t(locale, 'content.history.distributionSubtitle', { count: daysInWindow })}
          </p>
        </div>

        {/* Library owns overflowX; we size blockSize so mid/large screens fit without scroll. */}
        <div ref={frameRef} className="w-full">
          <ActivityCalendar
            data={data}
            colorScheme={colorScheme}
            theme={HISTORY_CALENDAR_THEME}
            maxLevel={HISTORY_ACTIVITY_MAX_LEVEL}
            blockSize={blockSize}
            blockMargin={HISTORY_CALENDAR_BLOCK_MARGIN}
            blockRadius={2}
            fontSize={HISTORY_CALENDAR_FONT_SIZE}
            weekStart={0}
            showMonthLabels
            showColorLegend
            showTotalCount={false}
            showWeekdayLabels={['mon', 'wed', 'fri']}
            labels={calendarLabels}
            tooltips={{
              activity: {
                text: (day) =>
                  day.level > 0
                    ? `${formatHistoryCalendarDate(day.date, locale)} · ${formatEngagedMinutesLabel(day.count, locale)}`
                    : `${formatHistoryCalendarDate(day.date, locale)} · ${t(locale, 'content.history.tooltipNotRead')}`,
              },
            }}
          />
        </div>
      </div>
    </section>
  );
}
