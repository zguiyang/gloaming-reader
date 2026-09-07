import { DEFAULT_PAGE, type PaginationMeta } from '@gloaming/shared/pagination';
import {
  TTS_INVOCATION_DEFAULT_PAGE_SIZE,
  type TtsInvocationListData,
  ttsInvocationListDataSchema,
  type TtsInvocationListQuery,
  type TtsInvocationStats,
  type TtsInvocationStatsQuery,
  ttsInvocationStatsSchema,
} from '@gloaming/shared/tts-invocations';

import { apiRequest, formatApiError } from '@/lib/api-request';

export type AdminTtsInvocationListParams = Partial<TtsInvocationListQuery>;
export type AdminTtsInvocationStatsParams = Partial<TtsInvocationStatsQuery>;

export type AdminTtsInvocationListResult = {
  items: TtsInvocationListData['items'];
  pagination: PaginationMeta;
};

export const adminTtsLogsQueryKey = {
  all: ['admin-tts-logs'] as const,
  list: (params: AdminTtsInvocationListParams) => [...adminTtsLogsQueryKey.all, 'list', params] as const,
  stats: (params: AdminTtsInvocationStatsParams) => [...adminTtsLogsQueryKey.all, 'stats', params] as const,
};

function appendIso(search: URLSearchParams, key: string, value: Date | string | undefined) {
  if (!value) {
    return;
  }
  search.set(key, value instanceof Date ? value.toISOString() : new Date(value).toISOString());
}

function buildFilterQuery(params: AdminTtsInvocationStatsParams): URLSearchParams {
  const search = new URLSearchParams();
  appendIso(search, 'from', params.from);
  appendIso(search, 'to', params.to);
  if (params.status) {
    search.set('status', params.status);
  }
  return search;
}

function buildListQuery(params: AdminTtsInvocationListParams): string {
  const search = buildFilterQuery(params);
  search.set('page', String(params.page ?? DEFAULT_PAGE));
  search.set('pageSize', String(params.pageSize ?? TTS_INVOCATION_DEFAULT_PAGE_SIZE));
  if (params.sortBy) {
    search.set('sortBy', params.sortBy);
  }
  if (params.sortOrder) {
    search.set('sortOrder', params.sortOrder);
  }
  if (params.partId) {
    search.set('partId', params.partId);
  }
  return search.toString();
}

export async function listAdminTtsInvocations(
  params: AdminTtsInvocationListParams = {},
  init?: { signal?: AbortSignal },
): Promise<AdminTtsInvocationListResult> {
  const qs = buildListQuery(params);
  return apiRequest(`/api/admin/tts/invocations?${qs}`, {
    schema: ttsInvocationListDataSchema,
    signal: init?.signal,
  });
}

export async function getAdminTtsInvocationStats(
  params: AdminTtsInvocationStatsParams = {},
  init?: { signal?: AbortSignal },
): Promise<TtsInvocationStats> {
  const qs = buildFilterQuery(params).toString();
  return apiRequest(`/api/admin/tts/invocations/stats${qs ? `?${qs}` : ''}`, {
    schema: ttsInvocationStatsSchema,
    signal: init?.signal,
  });
}

export const formatAdminTtsLogsApiError = formatApiError;
