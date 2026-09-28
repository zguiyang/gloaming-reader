import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { getLibrary } from '@/features/library/library-public';
import { apiRequest, formatApiError } from '@/lib/api-request';

export const libraryQueryKey = {
  all: ['library'] as const,
};

export function useLibraryQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: libraryQueryKey.all,
    queryFn: ({ signal }) => getLibrary({ signal }),
    enabled: options?.enabled ?? true,
  });
}

export const formatLibraryApiError = formatApiError;

export async function addToLibrary(workId: string): Promise<void> {
  await apiRequest(`/api/library/${encodeURIComponent(workId)}`, { method: 'POST', schema: z.undefined() });
}

export async function removeFromLibrary(workId: string): Promise<void> {
  await apiRequest(`/api/library/${encodeURIComponent(workId)}`, { method: 'DELETE', schema: z.undefined() });
}
