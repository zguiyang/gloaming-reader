import {
  AI_INVOCATION_DEFAULT_PAGE_SIZE,
  type AiInvocationListData,
  aiInvocationListDataSchema,
  type AiInvocationListQuery,
  type AiInvocationStats,
  type AiInvocationStatsQuery,
  aiInvocationStatsSchema,
} from '@gloaming/shared/ai-invocations';
import { DEFAULT_PAGE, type PaginationMeta } from '@gloaming/shared/pagination';

import { apiRequest, formatApiError } from '@/lib/api-request';

export type AdminInvocationListParams = Partial<AiInvocationListQuery>;
export type AdminInvocationStatsParams = Partial<AiInvocationStatsQuery>;

export type AdminInvocationListResult = {
  items: AiInvocationListData['items'];
  pagination: PaginationMeta;
};

export const adminAiLogsQueryKey = {
  all: ['admin-ai-logs'] as const,
  list: (params: AdminInvocationListParams) => [...adminAiLogsQueryKey.all, 'list', params] as const,
  stats: (params: AdminInvocationStatsParams) => [...adminAiLogsQueryKey.all, 'stats', params] as const,
};

function appendIso(search: URLSearchParams, key: string, value: Date | string | undefined) {
  if (!value) {
    return;
  }
  search.set(key, value instanceof Date ? value.toISOString() : new Date(value).toISOString());
}

function buildFilterQuery(params: AdminInvocationStatsParams): URLSearchParams {
  const search = new URLSearchParams();
  appendIso(search, 'from', params.from);
  appendIso(search, 'to', params.to);
  if (params.status) {
    search.set('status', params.status);
  }
  return search;
}

function buildListQuery(params: AdminInvocationListParams): string {
  const search = buildFilterQuery(params);
  search.set('page', String(params.page ?? DEFAULT_PAGE));
  search.set('pageSize', String(params.pageSize ?? AI_INVOCATION_DEFAULT_PAGE_SIZE));
  if (params.sortBy) {
    search.set('sortBy', params.sortBy);
  }
  if (params.sortOrder) {
    search.set('sortOrder', params.sortOrder);
  }
  return search.toString();
}

export async function listAdminInvocations(
  params: AdminInvocationListParams = {},
  init?: { signal?: AbortSignal },
): Promise<AdminInvocationListResult> {
  const qs = buildListQuery(params);
  return apiRequest(`/api/admin/ai/invocations?${qs}`, {
    schema: aiInvocationListDataSchema,
    signal: init?.signal,
  });
}

export async function getAdminInvocationStats(
  params: AdminInvocationStatsParams = {},
  init?: { signal?: AbortSignal },
): Promise<AiInvocationStats> {
  const qs = buildFilterQuery(params).toString();
  return apiRequest(`/api/admin/ai/invocations/stats${qs ? `?${qs}` : ''}`, {
    schema: aiInvocationStatsSchema,
    signal: init?.signal,
  });
}

export const formatAdminAiLogsApiError = formatApiError;
