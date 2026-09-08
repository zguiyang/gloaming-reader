import { useQuery } from '@tanstack/react-query';

import { getShelf } from '@/features/shelf/shelf-public';
import { formatApiError } from '@/lib/api-request';

export const shelfQueryKey = {
  all: ['shelf'] as const,
};

export function useShelfQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: shelfQueryKey.all,
    queryFn: ({ signal }) => getShelf({ signal }),
    enabled: options?.enabled ?? true,
  });
}

export const formatShelfApiError = formatApiError;
