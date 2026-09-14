'use client';

import { useMemo } from 'react';

import { type Locale, t } from '@gloaming/i18n';

import type { HistoryViewModel } from '@/features/history/history-model';
import { useLocale } from '@/lib/locale-context';

type SummaryItem = {
  key: keyof HistoryViewModel['portrait'] | 'consecutive';
  label: string;
  mobileLabel: string;
  format: (s: HistoryViewModel['portrait']) => string;
};

function buildSummaryItems(locale: Locale): readonly SummaryItem[] {
  return [
    {
      key: 'readingDays',
      label: t(locale, 'content.history.statReadingDays'),
      mobileLabel: t(locale, 'content.history.statReadingDays'),
      format: (s) => String(s.readingDays),
    },
    {
      key: 'consecutive',
      label: t(locale, 'content.history.statConsecutive'),
      mobileLabel: t(locale, 'content.history.statConsecutive'),
      format: (s) => t(locale, 'content.history.statConsecutiveValue', { days: s.consecutiveDays }),
    },
    {
      key: 'completedWorks',
      label: t(locale, 'content.history.statCompletedWorks'),
      mobileLabel: t(locale, 'content.history.statCompletedWorks'),
      format: (s) => String(s.completedWorks),
    },
    {
      key: 'lookedUpWords',
      label: t(locale, 'content.history.statLookedUpWords'),
      mobileLabel: t(locale, 'content.history.statLookedUpWordsMobile'),
      format: (s) => s.lookedUpWords.toLocaleString(locale),
    },
  ] as const;
}

export function HistorySummary({ portrait }: { portrait: HistoryViewModel['portrait'] }) {
  const { locale } = useLocale();
  const summaryItems = useMemo(() => buildSummaryItems(locale), [locale]);

  return (
    <>
      <section className="hidden w-full items-center justify-center gap-10 border-b border-border/50 py-8 md:flex">
        {summaryItems.map((item) => (
          <div key={item.key} className="flex flex-col items-center gap-1">
            <span className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              {item.label}
            </span>
            <span className="font-heading text-2xl font-semibold text-foreground tabular-nums">
              {item.format(portrait)}
            </span>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-2 gap-3 md:hidden">
        {summaryItems.map((item) => (
          <div
            key={item.key}
            className="flex flex-col gap-1 rounded-xl border border-border/60 bg-card p-4 shadow-card"
          >
            <span className="text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
              {item.mobileLabel}
            </span>
            <span className="font-heading text-2xl font-semibold text-primary tabular-nums">
              {item.format(portrait)}
            </span>
          </div>
        ))}
      </section>
    </>
  );
}
