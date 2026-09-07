'use client';

import { keepPreviousData, type QueryKey, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { type PaginationMeta } from '@gloaming/shared/pagination';

import { useMinimumHold } from '@/components/use-minimum-hold';

export type PaginatedListData<TItem> = {
  items: TItem[];
  pagination: PaginationMeta;
};

type UsePaginatedQueryOptions<TItem, TData extends PaginatedListData<TItem>> = {
  queryKey: QueryKey;
  queryFn: (ctx: { signal: AbortSignal }) => Promise<TData>;
  page: number;
  onPageChange: (page: number) => void;
  /** When > 0, soft-refresh stays visible at least this long. */
  softRefreshMinMs?: number;
  enabled?: boolean;
};

/**
 * Shared server-paginated list query: keepPreviousData, page clamp, soft-refresh flags.
 * Callers own filter state and pass a stable queryKey / queryFn for the current params.
 */
export function usePaginatedQuery<TItem, TData extends PaginatedListData<TItem> = PaginatedListData<TItem>>(
  options: UsePaginatedQueryOptions<TItem, TData>,
) {
  const { queryKey, queryFn, page, onPageChange, softRefreshMinMs = 0, enabled = true } = options;

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => queryFn({ signal }),
    placeholderData: keepPreviousData,
    enabled,
  });

  const isInitialLoading = query.isPending && !query.data;
  const isSoftRefreshingRaw = query.isFetching && Boolean(query.isPlaceholderData);
  const isSoftRefreshingHeld = useMinimumHold(isSoftRefreshingRaw, Math.max(softRefreshMinMs, 1));
  const isSoftRefreshing = softRefreshMinMs > 0 ? isSoftRefreshingHeld : isSoftRefreshingRaw;

  const data = query.data;
  const items: TItem[] = data?.items ?? [];
  const pagination = data?.pagination;
  const total = pagination?.total ?? 0;
  const totalPages = pagination?.totalPages ?? 0;
  const pageSize = pagination?.pageSize;
  const safePage = totalPages > 0 ? Math.min(page, totalPages) : page;
  const hasPrevPage = safePage > 1;
  const hasNextPage = totalPages > 0 && safePage < totalPages;

  useEffect(() => {
    if (!pagination) {
      return;
    }
    if (pagination.totalPages >= 1 && page > pagination.totalPages) {
      onPageChange(pagination.totalPages);
    }
  }, [pagination, page, onPageChange]);

  return {
    query,
    data,
    items,
    pagination,
    total,
    totalPages,
    pageSize,
    page: safePage,
    hasPrevPage,
    hasNextPage,
    isInitialLoading,
    isSoftRefreshing,
    isError: query.isError,
    error: query.error,
    goPrev: () => {
      if (safePage > 1) {
        onPageChange(safePage - 1);
      }
    },
    goNext: () => {
      if (totalPages > 0 && safePage < totalPages) {
        onPageChange(safePage + 1);
      }
    },
  };
}
