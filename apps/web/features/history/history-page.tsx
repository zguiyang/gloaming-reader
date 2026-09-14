'use client';

import { useEffect } from 'react';

import { t } from '@gloaming/i18n';

import { Button } from '@/components/ui/button';
import { useAuthDialog } from '@/features/auth';
import { formatHistoryApiError, useReadingHistoryQuery } from '@/features/history/history-api';
import { HistoryEmptyState } from '@/features/history/history-empty-state';
import { HistoryHeader } from '@/features/history/history-header';
import { HistoryHeatmap } from '@/features/history/history-heatmap';
import { HistorySummary } from '@/features/history/history-summary';
import { HistoryWorks } from '@/features/history/history-works';
import { isUnauthorizedError } from '@/lib/api-request';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

function HistorySkeleton() {
  return (
    <div className="flex flex-col gap-10" aria-hidden>
      <div className="h-24 animate-pulse rounded-xl bg-surface-container-high" />
      <div className="h-48 animate-pulse rounded-2xl bg-surface-container-high" />
    </div>
  );
}

export function HistoryPage() {
  const { locale } = useLocale();
  const { openLogin } = useAuthDialog();
  const historyQuery = useReadingHistoryQuery();

  useEffect(() => {
    if (historyQuery.isError && isUnauthorizedError(historyQuery.error)) {
      openLogin({ reason: 'history' });
    }
  }, [historyQuery.error, historyQuery.isError, openLogin]);

  if (historyQuery.isPending) {
    return (
      <div className="flex w-full flex-col gap-10">
        <HistoryHeader />
        <HistorySkeleton />
      </div>
    );
  }

  if (historyQuery.isError && isUnauthorizedError(historyQuery.error)) {
    return (
      <div className="flex w-full flex-col gap-10">
        <HistoryHeader />
        <HistorySkeleton />
      </div>
    );
  }

  if (historyQuery.isError) {
    return (
      <div className="flex w-full flex-col items-center py-16 text-center">
        <HistoryHeader />
        <h2 className="font-heading text-2xl font-semibold">{t(locale, 'content.history.loadFailed')}</h2>
        <p className="mt-4 text-muted-foreground">{formatHistoryApiError(historyQuery.error)}</p>
        <Button className="mt-8 rounded-full px-10" onClick={() => void historyQuery.refetch()}>
          {t(locale, 'content.common.retry')}
        </Button>
      </div>
    );
  }

  const data = historyQuery.data;
  const isEmpty = data.portrait.readingDays === 0 && data.works.length === 0;

  return (
    <div
      className={cn(
        'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700',
        'flex w-full flex-col',
        isEmpty ? 'min-h-[70dvh] justify-center' : '',
      )}
    >
      {isEmpty ? (
        <>
          <HistoryHeader />
          <HistoryEmptyState />
        </>
      ) : (
        <div className="flex flex-col gap-10 md:gap-16">
          <HistoryHeader />
          <HistorySummary portrait={data.portrait} />
          <HistoryHeatmap today={data.today} activity={data.activity} />
          <HistoryWorks works={data.works} />
        </div>
      )}
    </div>
  );
}
