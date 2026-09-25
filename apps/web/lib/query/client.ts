import { QueryClient } from '@tanstack/react-query';

import { API_INVALID_RESPONSE_CODE, ApiRequestError } from '@/lib/api-request';

const QUERY_RETRY_LIMIT = 3;

/** Skip retries for 4xx — 404/401/409 will not resolve by waiting. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiRequestError) {
    if (error.status < 500) {
      return false;
    }
    if (error.code === API_INVALID_RESPONSE_CODE) {
      return false;
    }
  }
  return failureCount < QUERY_RETRY_LIMIT;
}

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        refetchOnWindowFocus: false,
        retry: shouldRetryQuery,
      },
    },
  });
}
