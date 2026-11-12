import { useQuery } from '@tanstack/react-query';

import { readingHistoryDataSchema } from '@gloaming/shared/reading-history';

import { type HistoryViewModel, toHistoryViewModel } from '@/features/history/history-model';
import { apiRequest, formatApiError } from '@/lib/api-request';

export const historyQueryKey = {
  all: ['reading-history'] as const,
};

export async function getReadingHistory(init?: { signal?: AbortSignal }): Promise<HistoryViewModel> {
  const data = await apiRequest('/api/reading-history', {
    schema: readingHistoryDataSchema,
    signal: init?.signal,
  });
  return toHistoryViewModel(data);
}

export function useReadingHistoryQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: historyQueryKey.all,
    queryFn: ({ signal }) => getReadingHistory({ signal }),
    enabled: options?.enabled ?? true,
  });
}

export const formatHistoryApiError = formatApiError;
