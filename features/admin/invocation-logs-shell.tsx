'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { t } from '@/i18n';

import { LoadingOverlay } from '@/components/loading-overlay';
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
  type InvocationLogsPresetDays,
  type InvocationLogsRange,
  type InvocationLogsRangePreset,
  type InvocationLogsStatusFilter,
} from '@/features/admin/invocation-logs-filters';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

export const INVOCATION_LOGS_TABLE_REFRESH_MIN_MS = 300;

const TABLE_SKELETON_ROW_COUNT = 6;

export type InvocationLogsColumn = {
  label: string;
  align?: 'right';
  widthClass?: string;
  /** Full skeleton bar class for this column, e.g. `h-5 w-12 rounded-full`. */
  skeletonClassName?: string;
};

export type InvocationLogsListState<TItem> = {
  items: TItem[];
  total: number;
  page: number;
  totalPages: number;
  hasPrevPage: boolean;
  hasNextPage: boolean;
  isInitialLoading: boolean;
  isSoftRefreshing: boolean;
  isError: boolean;
  error: unknown;
  /** Present once the list query has resolved at least once (placeholders excluded). */
  data?: unknown;
  goPrev: () => void;
  goNext: () => void;
};

export type InvocationLogsStatsSlot = {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  content: ReactNode;
};

type InvocationLogsShellProps<TItem> = {
  title: string;
  icon: LucideIcon;
  stats: InvocationLogsStatsSlot;
  formatStatsError: (error: unknown) => string;
  headerExtra?: ReactNode;
  rangeTab: InvocationLogsRangePreset;
  range: InvocationLogsRange;
  status: InvocationLogsStatusFilter;
  windowForDays: (days: InvocationLogsPresetDays) => InvocationLogsRange;
  onRangeTabChange: (tab: InvocationLogsRangePreset) => void;
  onRangeChange: (range: InvocationLogsRange) => void;
  onStatusChange: (status: InvocationLogsStatusFilter) => void;
  list: InvocationLogsListState<TItem>;
  columns: readonly InvocationLogsColumn[];
  desktopRows: ReactNode;
  mobileRows: ReactNode;
  emptyTitle: string;
  emptyDescription: string;
  loadFailedTitle: string;
  formatListError: (error: unknown) => string;
  pageSize: number;
  footer?: ReactNode;
};

function LogsTableSkeleton({ columns }: { columns: readonly InvocationLogsColumn[] }) {
  return (
    <div aria-hidden>
      <div className="hidden md:block">
        <Table className="min-w-[48rem]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((column) => (
                <TableHead
                  key={column.label}
                  className={cn(
                    'h-12 bg-surface-container-low px-5 text-muted-foreground',
                    column.align === 'right' && 'text-right',
                    column.widthClass,
                  )}
                >
                  {column.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: TABLE_SKELETON_ROW_COUNT }, (_, index) => (
              <TableRow key={index} className="border-border hover:bg-transparent">
                {columns.map((column) => (
                  <TableCell key={column.label} className={cn('px-5 py-4', column.align === 'right' && 'text-right')}>
                    <Skeleton
                      className={cn(
                        'bg-muted/70',
                        column.skeletonClassName ?? 'h-4 w-20',
                        column.align === 'right' && 'ml-auto',
                      )}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="flex flex-col divide-y divide-border md:hidden">
        {Array.from({ length: TABLE_SKELETON_ROW_COUNT }, (_, index) => (
          <li key={index} className="flex flex-col gap-2 px-4 py-4">
            <Skeleton className="h-4 w-36 max-w-full bg-muted/70" />
            <Skeleton className="h-4 w-28 bg-muted/70" />
            <Skeleton className="h-4 w-24 bg-muted/70" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatsSkeleton() {
  return <Skeleton className="h-[7.25rem] w-full rounded-2xl bg-muted/70" />;
}

export function InvocationLogsShell<TItem>({
  title,
  icon: Icon,
  stats,
  formatStatsError,
  headerExtra,
  rangeTab,
  range,
  status,
  windowForDays,
  onRangeTabChange,
  onRangeChange,
  onStatusChange,
  list,
  columns,
  desktopRows,
  mobileRows,
  emptyTitle,
  emptyDescription,
  loadFailedTitle,
  formatListError,
  pageSize,
  footer,
}: InvocationLogsShellProps<TItem>) {
  const { locale } = useLocale();

  return (
    <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 mx-auto max-w-6xl">
      <div className="min-w-0">
        <h1 className="font-heading text-3xl font-bold tracking-tight">{title}</h1>
      </div>

      <div className="mt-6 flex flex-col gap-8 md:mt-10">
        {stats.isPending ? (
          <StatsSkeleton />
        ) : stats.isError ? (
          <p className="rounded-2xl border border-border bg-secondary/60 px-5 py-8 text-sm text-destructive md:px-6">
            {formatStatsError(stats.error)}
          </p>
        ) : (
          stats.content
        )}

        {headerExtra}

        <div className="order-first flex flex-col gap-5 md:order-none">
          <InvocationLogsFilters
            rangeTab={rangeTab}
            range={range}
            status={status}
            windowForDays={windowForDays}
            onRangeTabChange={onRangeTabChange}
            onRangeChange={onRangeChange}
            onStatusChange={onStatusChange}
          />

          <div
            className="overflow-hidden rounded-2xl border border-border bg-card"
            aria-busy={list.isInitialLoading || list.isSoftRefreshing}
          >
            {list.isInitialLoading ? (
              <LogsTableSkeleton columns={columns} />
            ) : list.isError && list.data === undefined ? (
              <Empty className="border-0 py-16">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Icon />
                  </EmptyMedia>
                  <EmptyTitle>{loadFailedTitle}</EmptyTitle>
                  <EmptyDescription>{formatListError(list.error)}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : list.items.length === 0 ? (
              <Empty className="border-0 py-16">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Icon />
                  </EmptyMedia>
                  <EmptyTitle>{emptyTitle}</EmptyTitle>
                  <EmptyDescription>{emptyDescription}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <LoadingOverlay active={list.isSoftRefreshing} label={t(locale, 'admin.logs.listRefreshing')}>
                <div className="hidden md:block">
                  <Table className="min-w-[48rem]">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        {columns.map((column) => (
                          <TableHead
                            key={column.label}
                            className={cn(
                              'h-12 bg-surface-container-low px-5 text-muted-foreground',
                              column.align === 'right' && 'text-right',
                              column.widthClass,
                            )}
                          >
                            {column.label}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>{desktopRows}</TableBody>
                  </Table>
                </div>
                <ul className="flex flex-col divide-y divide-border md:hidden">{mobileRows}</ul>
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
              pageSize,
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

      {footer}
    </div>
  );
}
