'use client';

import { useQuery } from '@tanstack/react-query';
import { Volume2 } from 'lucide-react';
import { useState } from 'react';

import { DEFAULT_PAGE } from '@gloaming/shared/pagination';
import {
  TTS_INVOCATION_DEFAULT_PAGE_SIZE,
  type TtsInvocationLog,
  type TtsInvocationStats,
  ttsInvocationWindowForDays,
} from '@gloaming/shared/tts-invocations';

import { LoadingOverlay } from '@/components/loading-overlay';
import { Badge } from '@/components/ui/badge';
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
  InvocationLogsFilters,
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
import { usePaginatedQuery } from '@/lib/query';
import { cn } from '@/lib/utils';

const TABLE_REFRESH_MIN_MS = 300;
const TABLE_SKELETON_ROW_COUNT = 6;

const SOURCE_LABELS: Record<string, string> = {
  'admin.part_audio': '章节音频',
  'admin.article_audio': '章节音频',
  'admin.tts_test': '连通测试',
};

const ROLE_LABELS: Record<string, string> = {
  us: '美音',
  uk: '英音',
};

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

function roleLabel(role: string | null): string {
  if (!role) {
    return '默认';
  }
  return ROLE_LABELS[role] ?? role;
}

function formatDateTime(iso: string | Date): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return String(iso);
  }
}

function formatCount(value: number | null | undefined): string {
  if (value == null) {
    return '-';
  }
  return new Intl.NumberFormat('zh-CN').format(value);
}

function LogsTableSkeleton({ rows }: { rows: number }) {
  return (
    <Table className="min-w-[48rem]" aria-hidden>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">时间</TableHead>
          <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">片段</TableHead>
          <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">Voice</TableHead>
          <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">来源</TableHead>
          <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">状态</TableHead>
          <TableHead className="h-12 bg-surface-container-low px-5 text-right text-muted-foreground">延迟</TableHead>
          <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">错误</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: rows }, (_, index) => (
          <TableRow key={index} className="border-border hover:bg-transparent">
            <TableCell className="px-5 py-4">
              <Skeleton className="h-4 w-36 max-w-full bg-muted/70" />
            </TableCell>
            <TableCell className="px-5 py-4">
              <Skeleton className="h-4 w-28 bg-muted/70" />
            </TableCell>
            <TableCell className="px-5 py-4">
              <Skeleton className="h-4 w-24 bg-muted/70" />
            </TableCell>
            <TableCell className="px-5 py-4">
              <Skeleton className="h-4 w-16 bg-muted/70" />
            </TableCell>
            <TableCell className="px-5 py-4">
              <Skeleton className="h-5 w-12 rounded-full bg-muted/70" />
            </TableCell>
            <TableCell className="px-5 py-4 text-right">
              <Skeleton className="ml-auto h-4 w-14 bg-muted/70" />
            </TableCell>
            <TableCell className="px-5 py-4">
              <Skeleton className="h-4 w-32 bg-muted/70" />
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

function StatsCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col justify-center px-6 py-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function StatsRow({ stats }: { stats: TtsInvocationStats }) {
  return (
    <div className="grid grid-cols-1 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      <StatsCell label="成功" value={formatCount(stats.successCount)} />
      <StatsCell label="失败" value={formatCount(stats.failureCount)} />
      <StatsCell label="合计" value={formatCount(stats.totalCount)} />
    </div>
  );
}

export function TtsLogsPage() {
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
    softRefreshMinMs: TABLE_REFRESH_MIN_MS,
  });

  const statsQuery = useQuery({
    queryKey: adminTtsLogsQueryKey.stats(statsParams),
    queryFn: ({ signal }) => getAdminTtsInvocationStats(statsParams, { signal }),
  });

  return (
    <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 mx-auto max-w-6xl">
      <div className="min-w-0">
        <h1 className="font-heading text-3xl font-bold tracking-tight">音频调用日志</h1>
        <p className="mt-3 text-lg text-muted-foreground">查看文章 TTS 生成与连通测试记录。</p>
      </div>

      <div className="mt-10 flex flex-col gap-8">
        {statsQuery.isPending ? (
          <StatsSkeleton />
        ) : statsQuery.isError ? (
          <p className="rounded-2xl border border-border bg-secondary/60 px-5 py-8 text-sm text-destructive md:px-6">
            {formatAdminTtsLogsApiError(statsQuery.error)}
          </p>
        ) : statsQuery.data ? (
          <StatsRow stats={statsQuery.data} />
        ) : null}

        <div className="flex flex-col gap-5">
          <InvocationLogsFilters
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
          />

          <div
            className="overflow-hidden rounded-2xl border border-border bg-card"
            aria-busy={list.isInitialLoading || list.isSoftRefreshing}
          >
            {list.isInitialLoading ? (
              <LogsTableSkeleton rows={TABLE_SKELETON_ROW_COUNT} />
            ) : list.isError && !list.data ? (
              <Empty className="border-0 py-16">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Volume2 />
                  </EmptyMedia>
                  <EmptyTitle>无法加载音频日志</EmptyTitle>
                  <EmptyDescription>{formatAdminTtsLogsApiError(list.error)}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : list.items.length === 0 ? (
              <Empty className="border-0 py-16">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Volume2 />
                  </EmptyMedia>
                  <EmptyTitle>当前筛选下没有音频日志</EmptyTitle>
                  <EmptyDescription>试试调整时间范围或状态。</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <LoadingOverlay active={list.isSoftRefreshing} label="列表更新中…">
                <Table className="min-w-[48rem]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">时间</TableHead>
                      <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">片段</TableHead>
                      <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">Voice</TableHead>
                      <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">来源</TableHead>
                      <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">状态</TableHead>
                      <TableHead className="h-12 bg-surface-container-low px-5 text-right text-muted-foreground">
                        延迟
                      </TableHead>
                      <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">错误</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.items.map((log) => (
                      <TableRow
                        key={log.id}
                        className="border-border transition-colors duration-300 ease-out-soft hover:bg-surface-container-low"
                      >
                        <TableCell className="px-5 py-4 tabular-nums text-muted-foreground">
                          {formatDateTime(log.createdAt)}
                        </TableCell>
                        <TableCell className="px-5 py-4 text-foreground">
                          {log.partTitle ?? (log.partId ? log.partId.slice(0, 8) : '—')}
                        </TableCell>
                        <TableCell className="px-5 py-4 text-muted-foreground">
                          <span className="block">{log.voice ?? '—'}</span>
                          <span className="text-xs">{roleLabel(log.role)}</span>
                        </TableCell>
                        <TableCell className="px-5 py-4 text-muted-foreground">{sourceLabel(log.source)}</TableCell>
                        <TableCell className="px-5 py-4">
                          <Badge variant={log.status === 'success' ? 'secondary' : 'destructive'}>
                            {log.status === 'success' ? '成功' : '失败'}
                          </Badge>
                          {log.cached ? <span className="ml-2 text-xs text-muted-foreground">缓存</span> : null}
                        </TableCell>
                        <TableCell className="px-5 py-4 text-right tabular-nums text-muted-foreground">
                          {log.latencyMs == null ? '—' : `${formatCount(log.latencyMs)} ms`}
                        </TableCell>
                        <TableCell className="max-w-[14rem] truncate px-5 py-4 text-muted-foreground">
                          {log.errorMessage ?? '—'}
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
            共 {list.total} 条 · 第 {list.totalPages === 0 ? 0 : list.page} / {list.totalPages} 页 · 每页{' '}
            {TTS_INVOCATION_DEFAULT_PAGE_SIZE}
          </p>
          {list.hasPrevPage || list.hasNextPage ? (
            <Pagination className="mx-0 w-auto justify-end">
              <PaginationContent className="gap-2">
                <PaginationItem>
                  <PaginationPrevious
                    text="上一页"
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
                    text="下一页"
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
    </div>
  );
}
