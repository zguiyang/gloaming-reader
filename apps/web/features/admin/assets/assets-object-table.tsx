'use client';

import type {
  AssetCategoryFilter,
  AssetObjectListQuery,
  AssetObjectStatus,
  AssetStatusFilter,
} from '@gloaming/shared/assets';
import { ASSET_CATEGORIES } from '@gloaming/shared/assets';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { cn } from '@/lib/utils';

type AssetsObjectTableProps = {
  scanId: string;
  query: AssetObjectListQuery;
  onQueryChange: (next: AssetObjectListQuery) => void;
};

const STATUS_TABS: { value: AssetStatusFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'referenced', label: '正常' },
  { value: 'orphan', label: '孤儿' },
  { value: 'missing', label: '缺失' },
];

const CATEGORY_TABS: { value: AssetCategoryFilter; label: string }[] = [
  { value: 'all', label: '全部分类' },
  ...ASSET_CATEGORIES.map((category) => ({ value: category, label: assetCategoryLabel(category) })),
];

function StatusBadge({ status }: { status: AssetObjectStatus }) {
  return (
    <Badge
      variant={status === 'orphan' ? 'destructive' : status === 'missing' ? 'outline' : 'secondary'}
      className={cn(status === 'missing' && 'border-destructive/40 text-destructive')}
    >
      {assetStatusLabel(status)}
    </Badge>
  );
}

export function AssetsObjectTable({ scanId, query, onQueryChange }: AssetsObjectTableProps) {
  const { data, isLoading, isFetching, isError, error } = useScanObjectsQuery(scanId, query);
  const totalPages = data?.pagination.totalPages ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>对象明细</CardTitle>
        <CardDescription>可按状态与分类筛选，默认按大小倒序</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => (
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
          {CATEGORY_TABS.map((tab) => (
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
          {(
            [
              { sortBy: 'size', label: '大小' },
              { sortBy: 'lastModified', label: '修改时间' },
              { sortBy: 'key', label: 'Key' },
            ] as const
          ).map((option) => {
            const isActive = query.sortBy === option.sortBy;
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
                排序：{option.label} {isActive ? (query.sortOrder === 'desc' ? '↓' : '↑') : ''}
              </Button>
            );
          })}
        </div>

        {isError ? (
          <p className="text-destructive text-sm">{error instanceof Error ? error.message : '加载失败'}</p>
        ) : null}

        <div className="overflow-x-auto rounded-lg ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>对象 Key</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>大小</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>最后修改</TableHead>
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
                    没有匹配的对象
                  </TableCell>
                </TableRow>
              ) : null}
              {data?.items.map((item) => (
                <TableRow key={`${item.status}:${item.key}`} className={cn(isFetching && 'opacity-70')}>
                  <TableCell className="max-w-[28rem] truncate font-medium" title={item.key}>
                    {shortObjectKey(item.key)}
                  </TableCell>
                  <TableCell>{assetCategoryLabel(item.category)}</TableCell>
                  <TableCell className="tabular-nums">{formatStorageBytes(item.size)}</TableCell>
                  <TableCell>
                    <StatusBadge status={item.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.lastModified ? formatMeasuredAt(item.lastModified) : '—'}
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
