'use client';

import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { useState } from 'react';

import { t } from '@/i18n';
import {
  AI_INVOCATION_DEFAULT_PAGE_SIZE,
  type AiInvocationLog,
  type AiInvocationStats,
  aiInvocationWindowForDays,
} from '@/shared/ai-invocations';
import { DEFAULT_PAGE } from '@/shared/pagination';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import {
  formatAdminAiPurpose,
  formatAdminAiSource,
  formatAdminCount,
  formatAdminDateTime,
  formatAdminInvocationStatus,
} from '@/features/admin/admin-logs-format';
import { adminLlmQueryKey, listLlmProviders } from '@/features/admin/ai/ai-config-api';
import { AiLogDetailDialog } from '@/features/admin/ai/ai-log-detail-dialog';
import {
  adminAiLogsQueryKey,
  type AdminInvocationListParams,
  type AdminInvocationListResult,
  formatAdminAiLogsApiError,
  getAdminInvocationStats,
  listAdminInvocations,
} from '@/features/admin/ai/ai-logs-api';
import { AiProviderBalanceCards } from '@/features/admin/ai/ai-provider-balance-cards';
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
import { useLocale } from '@/lib/locale-context';
import { usePaginatedQuery } from '@/lib/query';

function StatsCell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col justify-center px-6 py-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-3xl font-semibold tracking-tight tabular-nums text-foreground">
        <span>{value}</span>
        {hint ? <span className="text-sm font-normal text-muted-foreground">{hint}</span> : null}
      </p>
    </div>
  );
}

function StatsRow({ stats, locale }: { stats: AiInvocationStats; locale: ReturnType<typeof useLocale>['locale'] }) {
  return (
    <div className="grid grid-cols-1 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      <StatsCell
        label={t(locale, 'admin.logs.ai.statsInputTokens')}
        value={formatAdminCount(stats.inputTokens, locale)}
      />
      <StatsCell
        label={t(locale, 'admin.logs.ai.statsOutputTokens')}
        value={formatAdminCount(stats.outputTokens, locale)}
      />
      <StatsCell
        label={t(locale, 'admin.logs.ai.statsCost')}
        value={t(locale, 'admin.logs.costPlaceholder')}
        hint={t(locale, 'admin.logs.costNotPricedHint')}
      />
    </div>
  );
}

export function AiLogsPage() {
  const { locale } = useLocale();
  const [page, setPage] = useState<number>(DEFAULT_PAGE);
  const [selected, setSelected] = useState<AiInvocationLog | null>(null);
  const [rangeTab, setRangeTab] = useState<InvocationLogsRangePreset>('30');
  const [range, setRange] = useState<InvocationLogsRange>(() => aiInvocationWindowForDays(30));
  const [status, setStatus] = useState<InvocationLogsStatusFilter>('all');

  const listParams: AdminInvocationListParams = {
    page,
    pageSize: AI_INVOCATION_DEFAULT_PAGE_SIZE,
    from: range.from,
    to: range.to,
    status: status === 'all' ? undefined : status,
  };

  const statsParams = {
    from: range.from,
    to: range.to,
    status: status === 'all' ? undefined : status,
  };

  const list = usePaginatedQuery<AiInvocationLog, AdminInvocationListResult>({
    queryKey: adminAiLogsQueryKey.list(listParams),
    queryFn: ({ signal }) => listAdminInvocations(listParams, { signal }),
    page,
    onPageChange: setPage,
    softRefreshMinMs: INVOCATION_LOGS_TABLE_REFRESH_MIN_MS,
  });

  const statsQuery = useQuery({
    queryKey: adminAiLogsQueryKey.stats(statsParams),
    queryFn: ({ signal }) => getAdminInvocationStats(statsParams, { signal }),
  });

  const providersQuery = useQuery({
    queryKey: adminLlmQueryKey.providers(),
    queryFn: ({ signal }) => listLlmProviders({ signal }),
  });

  const columns: InvocationLogsColumn[] = [
    { label: t(locale, 'admin.logs.table.time'), skeletonClassName: 'h-4 w-36 max-w-full' },
    { label: t(locale, 'admin.logs.table.source'), skeletonClassName: 'h-4 w-20' },
    { label: t(locale, 'admin.logs.table.type'), skeletonClassName: 'h-4 w-16' },
    { label: t(locale, 'admin.logs.table.status'), skeletonClassName: 'h-5 w-12 rounded-full' },
    { label: t(locale, 'admin.logs.table.model'), skeletonClassName: 'h-4 w-24' },
    { label: t(locale, 'admin.logs.table.tokens'), align: 'right', skeletonClassName: 'h-4 w-14' },
    {
      label: t(locale, 'admin.logs.table.actions'),
      align: 'right',
      widthClass: 'w-[1%]',
      skeletonClassName: 'h-8 w-12 rounded-xl',
    },
  ];

  return (
    <InvocationLogsShell
      title={t(locale, 'admin.logs.ai.title')}
      icon={ScrollText}
      stats={{
        isPending: statsQuery.isPending,
        isError: statsQuery.isError,
        error: statsQuery.error,
        content: statsQuery.data ? <StatsRow stats={statsQuery.data} locale={locale} /> : null,
      }}
      formatStatsError={formatAdminAiLogsApiError}
      headerExtra={
        providersQuery.data && providersQuery.data.length > 0 ? (
          <AiProviderBalanceCards providers={providersQuery.data} />
        ) : null
      }
      rangeTab={rangeTab}
      range={range}
      status={status}
      windowForDays={aiInvocationWindowForDays}
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
      emptyTitle={t(locale, 'admin.logs.ai.emptyTitle')}
      emptyDescription={t(locale, 'admin.logs.ai.emptyDescription')}
      loadFailedTitle={t(locale, 'admin.logs.ai.loadFailedTitle')}
      formatListError={formatAdminAiLogsApiError}
      pageSize={AI_INVOCATION_DEFAULT_PAGE_SIZE}
      desktopRows={list.items.map((log) => (
        <TableRow
          key={log.id}
          className="border-border transition-colors duration-300 ease-out-soft hover:bg-surface-container-low"
        >
          <TableCell className="px-5 py-4 tabular-nums text-muted-foreground">
            {formatAdminDateTime(log.createdAt, locale)}
          </TableCell>
          <TableCell className="px-5 py-4 text-foreground">{formatAdminAiSource(log.source, locale)}</TableCell>
          <TableCell className="px-5 py-4 text-muted-foreground">{formatAdminAiPurpose(log.purpose, locale)}</TableCell>
          <TableCell className="px-5 py-4">
            <Badge variant={log.status === 'success' ? 'secondary' : 'destructive'}>
              {formatAdminInvocationStatus(log.status, locale)}
            </Badge>
          </TableCell>
          <TableCell className="px-5 py-4 text-muted-foreground">
            {log.modelId ?? t(locale, 'admin.logs.emptyValue')}
          </TableCell>
          <TableCell className="px-5 py-4 text-right tabular-nums text-muted-foreground">
            {formatAdminCount(log.totalTokens, locale)}
          </TableCell>
          <TableCell className="px-5 py-4 text-right">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-xl"
              aria-label={`${t(locale, 'admin.logs.ai.detailAction')} · ${formatAdminDateTime(log.createdAt, locale)} · ${formatAdminAiSource(log.source, locale)}`}
              onClick={() => setSelected(log)}
            >
              {t(locale, 'admin.logs.ai.detailAction')}
            </Button>
          </TableCell>
        </TableRow>
      ))}
      mobileRows={list.items.map((log) => (
        <li key={log.id} className="flex flex-col gap-3 px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm tabular-nums text-muted-foreground">{formatAdminDateTime(log.createdAt, locale)}</p>
              <p className="mt-1 font-medium text-foreground">{formatAdminAiSource(log.source, locale)}</p>
            </div>
            <Badge variant={log.status === 'success' ? 'secondary' : 'destructive'}>
              {formatAdminInvocationStatus(log.status, locale)}
            </Badge>
          </div>
          <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t(locale, 'admin.logs.table.type')}</dt>
            <dd className="min-w-0 text-foreground">{formatAdminAiPurpose(log.purpose, locale)}</dd>
            <dt className="text-muted-foreground">{t(locale, 'admin.logs.table.model')}</dt>
            <dd className="min-w-0 break-all text-muted-foreground">
              {log.modelId ?? t(locale, 'admin.logs.emptyValue')}
            </dd>
            <dt className="text-muted-foreground">{t(locale, 'admin.logs.table.tokens')}</dt>
            <dd className="min-w-0 tabular-nums text-muted-foreground">{formatAdminCount(log.totalTokens, locale)}</dd>
          </dl>
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-xl"
              aria-label={`${t(locale, 'admin.logs.ai.detailAction')} · ${formatAdminDateTime(log.createdAt, locale)} · ${formatAdminAiSource(log.source, locale)}`}
              onClick={() => setSelected(log)}
            >
              {t(locale, 'admin.logs.ai.detailAction')}
            </Button>
          </div>
        </li>
      ))}
      footer={
        <AiLogDetailDialog
          log={selected}
          sourceLabel={selected ? formatAdminAiSource(selected.source, locale) : ''}
          purposeLabel={selected ? formatAdminAiPurpose(selected.purpose, locale) : ''}
          onOpenChange={(open) => {
            if (!open) {
              setSelected(null);
            }
          }}
        />
      }
    />
  );
}
