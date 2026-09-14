'use client';

import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { useState } from 'react';

import { t } from '@gloaming/i18n';
import {
  AI_INVOCATION_DEFAULT_PAGE_SIZE,
  type AiInvocationLog,
  type AiInvocationStats,
  aiInvocationWindowForDays,
} from '@gloaming/shared/ai-invocations';
import { DEFAULT_PAGE } from '@gloaming/shared/pagination';

import { LoadingOverlay } from '@/components/loading-overlay';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  formatAdminAiPurpose,
  formatAdminAiSource,
  formatAdminCount,
  formatAdminDateTime,
  formatAdminInvocationStatus,
} from '@/features/admin/admin-logs-format';
import { adminLlmQueryKey, listLlmProviders } from '@/features/admin/ai/ai-config-api';
import { AiLogDetailSheet } from '@/features/admin/ai/ai-log-detail-sheet';
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
  InvocationLogsFilters,
  type InvocationLogsRange,
  type InvocationLogsRangePreset,
  type InvocationLogsStatusFilter,
} from '@/features/admin/invocation-logs-filters';
import { useLocale } from '@/lib/locale-context';
import { usePaginatedQuery } from '@/lib/query';
import { cn } from '@/lib/utils';

const TABLE_REFRESH_MIN_MS = 300;
const TABLE_SKELETON_ROW_COUNT = 6;

function LogsTableSkeleton({ rows, locale }: { rows: number; locale: ReturnType<typeof useLocale>['locale'] }) {
  return (
    <Table className="min-w-[48rem]" aria-hidden>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
            {t(locale, 'admin.logs.table.time')}
          </TableHead>
          <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
            {t(locale, 'admin.logs.table.source')}
          </TableHead>
          <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
            {t(locale, 'admin.logs.table.type')}
          </TableHead>
          <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
            {t(locale, 'admin.logs.table.status')}
          </TableHead>
          <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
            {t(locale, 'admin.logs.table.model')}
          </TableHead>
          <TableHead className="h-12 bg-surface-container-low px-5 text-right text-muted-foreground">
            {t(locale, 'admin.logs.table.tokens')}
          </TableHead>
          <TableHead className="h-12 w-[1%] bg-surface-container-low px-5 text-right text-muted-foreground">
            {t(locale, 'admin.logs.table.actions')}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: rows }, (_, index) => (
          <TableRow key={index} className="border-border hover:bg-transparent">
            <TableCell className="px-5 py-4">
              <Skeleton className="h-4 w-36 max-w-full bg-muted/70" />
            </TableCell>
            <TableCell className="px-5 py-4">
              <Skeleton className="h-4 w-20 bg-muted/70" />
            </TableCell>
            <TableCell className="px-5 py-4">
              <Skeleton className="h-4 w-16 bg-muted/70" />
            </TableCell>
            <TableCell className="px-5 py-4">
              <Skeleton className="h-5 w-12 rounded-full bg-muted/70" />
            </TableCell>
            <TableCell className="px-5 py-4">
              <Skeleton className="h-4 w-24 bg-muted/70" />
            </TableCell>
            <TableCell className="px-5 py-4 text-right">
              <Skeleton className="ml-auto h-4 w-14 bg-muted/70" />
            </TableCell>
            <TableCell className="px-5 py-4 text-right">
              <Skeleton className="ml-auto h-8 w-12 rounded-xl bg-muted/70" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function StatsSkeleton() {
  return <Skeleton className="h-[7.25rem] w-full rounded-2xl bg-muted/70" />;
}

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
    softRefreshMinMs: TABLE_REFRESH_MIN_MS,
  });

  const statsQuery = useQuery({
    queryKey: adminAiLogsQueryKey.stats(statsParams),
    queryFn: ({ signal }) => getAdminInvocationStats(statsParams, { signal }),
  });

  const providersQuery = useQuery({
    queryKey: adminLlmQueryKey.providers(),
    queryFn: ({ signal }) => listLlmProviders({ signal }),
  });

  return (
    <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 mx-auto max-w-6xl">
      <div className="min-w-0">
        <h1 className="font-heading text-3xl font-bold tracking-tight">{t(locale, 'admin.logs.ai.title')}</h1>
        <p className="mt-3 text-lg text-muted-foreground">{t(locale, 'admin.logs.ai.subtitle')}</p>
      </div>

      <div className="mt-10 flex flex-col gap-8">
        {statsQuery.isPending ? (
          <StatsSkeleton />
        ) : statsQuery.isError ? (
          <p className="rounded-2xl border border-border bg-secondary/60 px-5 py-8 text-sm text-destructive md:px-6">
            {formatAdminAiLogsApiError(statsQuery.error)}
          </p>
        ) : statsQuery.data ? (
          <StatsRow stats={statsQuery.data} locale={locale} />
        ) : null}

        {providersQuery.data && providersQuery.data.length > 0 ? (
          <AiProviderBalanceCards providers={providersQuery.data} />
        ) : null}

        <div className="flex flex-col gap-5">
          <InvocationLogsFilters
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
          />

          <div
            className="overflow-hidden rounded-2xl border border-border bg-card"
            aria-busy={list.isInitialLoading || list.isSoftRefreshing}
          >
            {list.isInitialLoading ? (
              <LogsTableSkeleton rows={TABLE_SKELETON_ROW_COUNT} locale={locale} />
            ) : list.isError && !list.data ? (
              <Empty className="border-0 py-16">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ScrollText />
                  </EmptyMedia>
                  <EmptyTitle>{t(locale, 'admin.logs.ai.loadFailedTitle')}</EmptyTitle>
                  <EmptyDescription>{formatAdminAiLogsApiError(list.error)}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : list.items.length === 0 ? (
              <Empty className="border-0 py-16">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ScrollText />
                  </EmptyMedia>
                  <EmptyTitle>{t(locale, 'admin.logs.ai.emptyTitle')}</EmptyTitle>
                  <EmptyDescription>{t(locale, 'admin.logs.ai.emptyDescription')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <LoadingOverlay active={list.isSoftRefreshing} label={t(locale, 'admin.logs.listRefreshing')}>
                <Table className="min-w-[48rem]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
                        {t(locale, 'admin.logs.table.time')}
                      </TableHead>
                      <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
                        {t(locale, 'admin.logs.table.source')}
                      </TableHead>
                      <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
                        {t(locale, 'admin.logs.table.type')}
                      </TableHead>
                      <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
                        {t(locale, 'admin.logs.table.status')}
                      </TableHead>
                      <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
                        {t(locale, 'admin.logs.table.model')}
                      </TableHead>
                      <TableHead className="h-12 bg-surface-container-low px-5 text-right text-muted-foreground">
                        {t(locale, 'admin.logs.table.tokens')}
                      </TableHead>
                      <TableHead className="h-12 w-[1%] bg-surface-container-low px-5 text-right text-muted-foreground">
                        {t(locale, 'admin.logs.table.actions')}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.items.map((log) => (
                      <TableRow
                        key={log.id}
                        className="border-border transition-colors duration-300 ease-out-soft hover:bg-surface-container-low"
                      >
                        <TableCell className="px-5 py-4 tabular-nums text-muted-foreground">
                          {formatAdminDateTime(log.createdAt, locale)}
                        </TableCell>
                        <TableCell className="px-5 py-4 text-foreground">
                          {formatAdminAiSource(log.source, locale)}
                        </TableCell>
                        <TableCell className="px-5 py-4 text-muted-foreground">
                          {formatAdminAiPurpose(log.purpose, locale)}
                        </TableCell>
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
                          <Button variant="ghost" size="sm" className="rounded-xl" onClick={() => setSelected(log)}>
                            {t(locale, 'admin.logs.ai.detailAction')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </LoadingOverlay>
            )}
          </div>
        </div>
      </div>

      {!list.isInitialLoading && !list.isError ? (
        <div className="mt-8 flex flex-col items-center justify-between gap-4 sm:flex-row">
          <p className="text-sm text-muted-foreground">
            {t(locale, 'admin.logs.paginationSummary', {
              total: list.total,
              page: list.totalPages === 0 ? 0 : list.page,
              totalPages: list.totalPages,
              pageSize: AI_INVOCATION_DEFAULT_PAGE_SIZE,
            })}
          </p>
          {list.hasPrevPage || list.hasNextPage ? (
            <Pagination className="mx-0 w-auto justify-end">
              <PaginationContent className="gap-2">
                <PaginationItem>
                  <PaginationPrevious
                    text={t(locale, 'admin.logs.prevPage')}
                    href="#"
                    aria-disabled={!list.hasPrevPage}
                    className={cn(
                      'h-9 rounded-xl border border-border bg-background px-3.5',
                      !list.hasPrevPage && 'pointer-events-none opacity-50',
                    )}
                    onClick={(event) => {
                      event.preventDefault();
                      list.goPrev();
                    }}
                  />
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    text={t(locale, 'admin.logs.nextPage')}
                    href="#"
                    aria-disabled={!list.hasNextPage}
                    className={cn(
                      'h-9 rounded-xl border border-border bg-background px-3.5',
                      !list.hasNextPage && 'pointer-events-none opacity-50',
                    )}
                    onClick={(event) => {
                      event.preventDefault();
                      list.goNext();
                    }}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          ) : null}
        </div>
      ) : null}

      <AiLogDetailSheet
        log={selected}
        sourceLabel={selected ? formatAdminAiSource(selected.source, locale) : ''}
        purposeLabel={selected ? formatAdminAiPurpose(selected.purpose, locale) : ''}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
          }
        }}
      />
    </div>
  );
}
