'use client';

import { t } from '@gloaming/i18n';
import type {
  AssetCategoryFilter,
  AssetObjectListQuery,
  AssetObjectStatus,
  AssetStatusFilter,
} from '@gloaming/shared/assets';
import { ASSET_CATEGORIES } from '@gloaming/shared/assets';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useScanObjectsQuery } from '@/features/admin/assets/assets-api';
import {
  assetCategoryLabel,
  assetStatusLabel,
  formatMeasuredAt,
  formatStorageBytes,
  shortObjectKey,
} from '@/features/admin/assets/assets-format';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

type AssetsObjectTableProps = {
  scanId: string;
  query: AssetObjectListQuery;
  onQueryChange: (next: AssetObjectListQuery) => void;
};

const STATUS_FILTER_KEYS: Record<AssetStatusFilter, string> = {
  all: 'filterAll',
  referenced: 'filterReferenced',
  orphan: 'filterOrphan',
  legacy_duplicate_audio: 'filterLegacyDuplicate',
  missing: 'filterMissing',
};

const SORT_OPTIONS = [
  { sortBy: 'size', labelKey: 'sortSize' },
  { sortBy: 'lastModified', labelKey: 'sortLastModified' },
  { sortBy: 'key', labelKey: 'sortKey' },
] as const;

function StatusBadge({
  status,
  locale,
}: {
  status: AssetObjectStatus;
  locale: ReturnType<typeof useLocale>['locale'];
}) {
  return (
    <Badge
      variant={
        status === 'orphan'
          ? 'destructive'
          : status === 'missing' || status === 'legacy_duplicate_audio'
            ? 'outline'
            : 'secondary'
      }
      className={cn(
        status === 'missing' && 'border-destructive/40 text-destructive',
        status === 'legacy_duplicate_audio' && 'border-amber-500/40 text-amber-700 dark:text-amber-400',
      )}
    >
      {assetStatusLabel(status, locale)}
    </Badge>
  );
}

export function AssetsObjectTable({ scanId, query, onQueryChange }: AssetsObjectTableProps) {
  const { locale } = useLocale();
  const { data, isLoading, isFetching, isError } = useScanObjectsQuery(scanId, query);
  const totalPages = data?.pagination.totalPages ?? 0;

  const statusTabs = (Object.keys(STATUS_FILTER_KEYS) as AssetStatusFilter[]).map((value) => ({
    value,
    label: t(locale, `admin.assets.table.${STATUS_FILTER_KEYS[value]}`),
  }));

  const categoryTabs: { value: AssetCategoryFilter; label: string }[] = [
    { value: 'all', label: t(locale, 'admin.assets.table.filterAllCategories') },
    ...ASSET_CATEGORIES.map((category) => ({ value: category, label: assetCategoryLabel(category, locale) })),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(locale, 'admin.assets.table.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {statusTabs.map((tab) => (
            <Button
              key={tab.value}
              size="sm"
              variant={query.status === tab.value ? 'default' : 'outline'}
              onClick={() => onQueryChange({ ...query, status: tab.value, page: 1 })}
            >
              {tab.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {categoryTabs.map((tab) => (
            <Button
              key={tab.value}
              size="sm"
              variant={query.category === tab.value ? 'secondary' : 'ghost'}
              onClick={() => onQueryChange({ ...query, category: tab.value, page: 1 })}
            >
              {tab.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {SORT_OPTIONS.map((option) => {
            const isActive = query.sortBy === option.sortBy;
            const direction = isActive ? (query.sortOrder === 'desc' ? '↓' : '↑') : '';
            return (
              <Button
                key={option.sortBy}
                size="sm"
                variant={isActive ? 'outline' : 'ghost'}
                onClick={() =>
                  onQueryChange({
                    ...query,
                    sortBy: option.sortBy,
                    sortOrder: isActive && query.sortOrder === 'desc' ? 'asc' : 'desc',
                    page: 1,
                  })
                }
              >
                {t(locale, 'admin.assets.table.sortPrefix', {
                  label: t(locale, `admin.assets.table.${option.labelKey}`),
                  direction,
                })}
              </Button>
            );
          })}
        </div>

        {isError ? <p className="text-destructive text-sm">{t(locale, 'admin.assets.table.loadFailed')}</p> : null}

        <div className="overflow-x-auto rounded-lg ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t(locale, 'admin.assets.table.colKey')}</TableHead>
                <TableHead>{t(locale, 'admin.assets.table.colType')}</TableHead>
                <TableHead>{t(locale, 'admin.assets.table.colSize')}</TableHead>
                <TableHead>{t(locale, 'admin.assets.table.colStatus')}</TableHead>
                <TableHead>{t(locale, 'admin.assets.table.colLastModified')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, index) => (
                    <TableRow key={index}>
                      <TableCell colSpan={5}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                : null}
              {!isLoading && data?.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground text-center">
                    {t(locale, 'admin.assets.table.empty')}
                  </TableCell>
                </TableRow>
              ) : null}
              {data?.items.map((item) => (
                <TableRow key={`${item.status}:${item.key}`} className={cn(isFetching && 'opacity-70')}>
                  <TableCell className="max-w-[28rem] truncate font-medium" title={item.key}>
                    {shortObjectKey(item.key)}
                  </TableCell>
                  <TableCell>{assetCategoryLabel(item.category, locale)}</TableCell>
                  <TableCell className="tabular-nums">{formatStorageBytes(item.size)}</TableCell>
                  <TableCell>
                    <StatusBadge status={item.status} locale={locale} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.lastModified
                      ? formatMeasuredAt(item.lastModified, locale)
                      : t(locale, 'admin.content.common.notFilled')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {totalPages > 1 ? (
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    if (query.page > 1) onQueryChange({ ...query, page: query.page - 1 });
                  }}
                  className={cn(query.page <= 1 && 'pointer-events-none opacity-50')}
                />
              </PaginationItem>
              <PaginationItem>
                <span className="text-muted-foreground px-3 text-sm tabular-nums">
                  {query.page} / {totalPages}
                </span>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    if (query.page < totalPages) onQueryChange({ ...query, page: query.page + 1 });
                  }}
                  className={cn(query.page >= totalPages && 'pointer-events-none opacity-50')}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        ) : null}
      </CardContent>
    </Card>
  );
}
