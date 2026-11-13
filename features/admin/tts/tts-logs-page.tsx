'use client';

import { useQuery } from '@tanstack/react-query';
import { Volume2 } from 'lucide-react';
import { useState } from 'react';

import { t } from '@/i18n';
import { DEFAULT_PAGE } from '@/shared/pagination';
import {
  TTS_INVOCATION_DEFAULT_PAGE_SIZE,
  type TtsInvocationLog,
  type TtsInvocationStats,
  ttsInvocationWindowForDays,
} from '@/shared/tts-invocations';

import { Badge } from '@/components/ui/badge';
import { TableCell, TableRow } from '@/components/ui/table';
import {
  formatAdminCount,
  formatAdminDateTime,
  formatAdminInvocationStatus,
  formatAdminLatencyMs,
  formatAdminTtsRole,
  formatAdminTtsSource,
} from '@/features/admin/admin-logs-format';
import {
  INVOCATION_LOGS_TABLE_REFRESH_MIN_MS,
  InvocationLogsShell,
  type InvocationLogsColumn,
} from '@/features/admin/invocation-logs-shell';
import {
  type InvocationLogsRange,
  type InvocationLogsRangePreset,
  type InvocationLogsStatusFilter,
} from '@/features/admin/invocation-logs-filters';
import {
  type AdminTtsInvocationListParams,
  type AdminTtsInvocationListResult,
  adminTtsLogsQueryKey,
  formatAdminTtsLogsApiError,
  getAdminTtsInvocationStats,
  listAdminTtsInvocations,
} from '@/features/admin/tts/tts-logs-api';
import { useLocale } from '@/lib/locale-context';
import { usePaginatedQuery } from '@/lib/query';

function StatsCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col justify-center px-6 py-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function StatsRow({ stats, locale }: { stats: TtsInvocationStats; locale: ReturnType<typeof useLocale>['locale'] }) {
  return (
    <div className="grid grid-cols-1 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      <StatsCell
        label={t(locale, 'admin.logs.tts.statsSuccess')}
        value={formatAdminCount(stats.successCount, locale)}
      />
      <StatsCell
        label={t(locale, 'admin.logs.tts.statsFailure')}
        value={formatAdminCount(stats.failureCount, locale)}
      />
      <StatsCell label={t(locale, 'admin.logs.tts.statsTotal')} value={formatAdminCount(stats.totalCount, locale)} />
    </div>
  );
}

export function TtsLogsPage() {
  const { locale } = useLocale();
  const [page, setPage] = useState<number>(DEFAULT_PAGE);
  const [rangeTab, setRangeTab] = useState<InvocationLogsRangePreset>('30');
  const [range, setRange] = useState<InvocationLogsRange>(() => ttsInvocationWindowForDays(30));
  const [status, setStatus] = useState<InvocationLogsStatusFilter>('all');

  const listParams: AdminTtsInvocationListParams = {
    page,
    pageSize: TTS_INVOCATION_DEFAULT_PAGE_SIZE,
    from: range.from,
    to: range.to,
    status: status === 'all' ? undefined : status,
  };

  const statsParams = {
    from: range.from,
    to: range.to,
    status: status === 'all' ? undefined : status,
  };

  const list = usePaginatedQuery<TtsInvocationLog, AdminTtsInvocationListResult>({
    queryKey: adminTtsLogsQueryKey.list(listParams),
    queryFn: ({ signal }) => listAdminTtsInvocations(listParams, { signal }),
    page,
    onPageChange: setPage,
    softRefreshMinMs: INVOCATION_LOGS_TABLE_REFRESH_MIN_MS,
  });

  const statsQuery = useQuery({
    queryKey: adminTtsLogsQueryKey.stats(statsParams),
    queryFn: ({ signal }) => getAdminTtsInvocationStats(statsParams, { signal }),
  });

  const columns: InvocationLogsColumn[] = [
    { label: t(locale, 'admin.logs.table.time'), skeletonClassName: 'h-4 w-36 max-w-full' },
    { label: t(locale, 'admin.logs.table.segment'), skeletonClassName: 'h-4 w-28' },
    { label: t(locale, 'admin.logs.table.voice'), skeletonClassName: 'h-4 w-24' },
    { label: t(locale, 'admin.logs.table.source'), skeletonClassName: 'h-4 w-16' },
    { label: t(locale, 'admin.logs.table.status'), skeletonClassName: 'h-5 w-12 rounded-full' },
    { label: t(locale, 'admin.logs.table.latency'), align: 'right', skeletonClassName: 'h-4 w-14' },
    { label: t(locale, 'admin.logs.table.error'), skeletonClassName: 'h-4 w-32' },
  ];

  return (
    <InvocationLogsShell
      title={t(locale, 'admin.logs.tts.title')}
      icon={Volume2}
      stats={{
        isPending: statsQuery.isPending,
        isError: statsQuery.isError,
        error: statsQuery.error,
        content: statsQuery.data ? <StatsRow stats={statsQuery.data} locale={locale} /> : null,
      }}
      formatStatsError={formatAdminTtsLogsApiError}
      rangeTab={rangeTab}
      range={range}
      status={status}
      windowForDays={ttsInvocationWindowForDays}
      onRangeTabChange={(tab) => {
        setRangeTab(tab);
        setPage(DEFAULT_PAGE);
      }}
      onRangeChange={(next) => {
        setRange(next);
        setPage(DEFAULT_PAGE);
      }}
      onStatusChange={(next) => {
        setStatus(next);
        setPage(DEFAULT_PAGE);
      }}
      list={list}
      columns={columns}
      emptyTitle={t(locale, 'admin.logs.tts.emptyTitle')}
      emptyDescription={t(locale, 'admin.logs.tts.emptyDescription')}
      loadFailedTitle={t(locale, 'admin.logs.tts.loadFailedTitle')}
      formatListError={formatAdminTtsLogsApiError}
      pageSize={TTS_INVOCATION_DEFAULT_PAGE_SIZE}
      desktopRows={list.items.map((log) => (
        <TableRow
          key={log.id}
          className="border-border transition-colors duration-300 ease-out-soft hover:bg-surface-container-low"
        >
          <TableCell className="px-5 py-4 tabular-nums text-muted-foreground">
            {formatAdminDateTime(log.createdAt, locale)}
          </TableCell>
          <TableCell className="px-5 py-4 text-foreground">
            {log.partTitle ?? (log.partId ? log.partId.slice(0, 8) : t(locale, 'admin.logs.emptyValue'))}
          </TableCell>
          <TableCell className="px-5 py-4 text-muted-foreground">
            <span className="block">{log.voice ?? t(locale, 'admin.logs.emptyValue')}</span>
            <span className="text-xs">{formatAdminTtsRole(log.role, locale)}</span>
          </TableCell>
          <TableCell className="px-5 py-4 text-muted-foreground">{formatAdminTtsSource(log.source, locale)}</TableCell>
          <TableCell className="px-5 py-4">
            <Badge variant={log.status === 'success' ? 'secondary' : 'destructive'}>
              {formatAdminInvocationStatus(log.status, locale)}
            </Badge>
            {log.cached ? (
              <span className="ml-2 text-xs text-muted-foreground">{t(locale, 'admin.logs.tts.cached')}</span>
            ) : null}
          </TableCell>
          <TableCell className="px-5 py-4 text-right tabular-nums text-muted-foreground">
            {formatAdminLatencyMs(log.latencyMs, locale)}
          </TableCell>
          <TableCell className="max-w-[14rem] px-5 py-4 whitespace-normal break-words text-muted-foreground">
            {log.errorMessage ?? t(locale, 'admin.logs.emptyValue')}
          </TableCell>
        </TableRow>
      ))}
      mobileRows={list.items.map((log) => (
        <li key={log.id} className="flex flex-col gap-2 px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm tabular-nums text-muted-foreground">{formatAdminDateTime(log.createdAt, locale)}</p>
              <p className="mt-1 font-medium text-foreground">
                {log.partTitle ?? (log.partId ? log.partId.slice(0, 8) : t(locale, 'admin.logs.emptyValue'))}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {log.cached ? (
                <span className="text-xs text-muted-foreground">{t(locale, 'admin.logs.tts.cached')}</span>
              ) : null}
              <Badge variant={log.status === 'success' ? 'secondary' : 'destructive'}>
                {formatAdminInvocationStatus(log.status, locale)}
              </Badge>
            </div>
          </div>
          <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t(locale, 'admin.logs.table.voice')}</dt>
            <dd className="min-w-0 text-foreground">
              <span className="block">{log.voice ?? t(locale, 'admin.logs.emptyValue')}</span>
              <span className="text-xs text-muted-foreground">{formatAdminTtsRole(log.role, locale)}</span>
            </dd>
            <dt className="text-muted-foreground">{t(locale, 'admin.logs.table.source')}</dt>
            <dd className="min-w-0 text-muted-foreground">{formatAdminTtsSource(log.source, locale)}</dd>
            <dt className="text-muted-foreground">{t(locale, 'admin.logs.table.latency')}</dt>
            <dd className="min-w-0 tabular-nums text-muted-foreground">
              {formatAdminLatencyMs(log.latencyMs, locale)}
            </dd>
            <dt className="text-muted-foreground">{t(locale, 'admin.logs.table.error')}</dt>
            <dd className="min-w-0 break-words text-muted-foreground">
              {log.errorMessage ?? t(locale, 'admin.logs.emptyValue')}
            </dd>
          </dl>
        </li>
      ))}
    />
  );
}
