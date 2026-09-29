import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import type { LibraryData } from '@gloaming/shared/library';
import {
  EPUB_UPLOAD_MAX_BYTES,
  type PersonalWorkUploadResult,
  personalWorkUploadResultSchema,
} from '@gloaming/shared/works';

import { getLibrary } from '@/features/library/library-public';
import { apiRequest, formatApiError } from '@/lib/api-request';

export const libraryQueryKey = {
  all: ['library'] as const,
};

export function libraryRefetchInterval(data?: LibraryData): number | false {
  return data?.items.some((item) => item.availability === 'processing') ? 2000 : false;
}

export function useLibraryQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: libraryQueryKey.all,
    queryFn: ({ signal }) => getLibrary({ signal }),
    refetchInterval: (query) => libraryRefetchInterval(query.state.data),
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

export function personalEpubValidationError(file: Pick<File, 'name' | 'size'>): 'format' | 'size' | null {
  if (file.name.split('.').pop()?.toLowerCase() !== 'epub') {
    return 'format';
  }
  if (file.size > EPUB_UPLOAD_MAX_BYTES) {
    return 'size';
  }
  return null;
}

export async function uploadPersonalEpub(file: File): Promise<PersonalWorkUploadResult> {
  const formData = new FormData();
  formData.append('file', file);
  return apiRequest('/api/works', {
    method: 'POST',
    body: formData,
    schema: personalWorkUploadResultSchema,
  });
}
