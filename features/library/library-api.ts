import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';

import { t, type Locale } from '@/i18n';
import {
  libraryBrowseDataSchema,
  type LibraryBrowseQuery,
  type LibraryData,
  type UserTag,
  userTagListSchema,
  userTagSchema,
} from '@/shared/library';
import { userTagTranslationsResultSchema } from '@/shared/library';
import {
  EPUB_UPLOAD_MAX_BYTES,
  personalWorkDeleteResultSchema,
  type PersonalWorkUpdate,
  type PersonalWorkUpdateResult,
  personalWorkUpdateResultSchema,
  type PersonalWorkUploadResult,
  personalWorkUploadResultSchema,
} from '@/shared/works';

import { getLibrary } from '@/features/library/library-public';
import { apiRequest, formatApiError } from '@/lib/api-request';
import { authClient } from '@/lib/auth';

export const libraryQueryKey = {
  all: ['library'] as const,
  tags: ['library', 'tags'] as const,
};

const PROCESSING_POLL_INTERVAL_MS = 2000;

function hasProcessingItem(items: ReadonlyArray<{ availability: string }>): boolean {
  return items.some((item) => item.availability === 'processing');
}

export function useLibraryBrowseQuery(query: Omit<LibraryBrowseQuery, 'page'>) {
  const { data: session } = authClient.useSession();
  return useInfiniteQuery({
    queryKey: [...libraryQueryKey.all, 'browse', session?.user.id ?? null, query],
    enabled: Boolean(session?.user.id),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        source: query.source,
        status: query.status,
        sort: query.sort,
        page: String(pageParam),
      });
      if (query.tag) params.set('tag', query.tag);
      if (query.q) params.set('q', query.q);
      return apiRequest(`/api/library/browse?${params}`, { schema: libraryBrowseDataSchema, signal });
    },
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length + 1 : undefined),
    // Keep the previous pages rendered while the debounced filter/key changes so
    // the grid does not flash empty on every keystroke.
    placeholderData: keepPreviousData,
    refetchInterval: (result) =>
      result.state.data && hasProcessingItem(result.state.data.pages.flatMap((page) => page.items))
        ? PROCESSING_POLL_INTERVAL_MS
        : false,
  });
}

export function useUserTagsQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: libraryQueryKey.tags,
    queryFn: ({ signal }) => apiRequest('/api/library/tags', { schema: userTagListSchema, signal }),
    enabled: options?.enabled ?? true,
  });
}

export function libraryRefetchInterval(data?: LibraryData): number | false {
  return data && hasProcessingItem(data.items) ? PROCESSING_POLL_INTERVAL_MS : false;
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

export async function removeFromLibrary(workId: string): Promise<void> {
  await apiRequest(`/api/library/${encodeURIComponent(workId)}`, { method: 'DELETE', schema: z.undefined() });
}

export async function updatePersonalWork(workId: string, patch: PersonalWorkUpdate): Promise<PersonalWorkUpdateResult> {
  return apiRequest(`/api/works/${encodeURIComponent(workId)}`, {
    method: 'PATCH',
    json: patch,
    schema: personalWorkUpdateResultSchema,
  });
}

export async function deletePersonalWork(workId: string): Promise<void> {
  await apiRequest(`/api/works/${encodeURIComponent(workId)}`, {
    method: 'DELETE',
    schema: personalWorkDeleteResultSchema,
  });
}

export async function createUserTag(name: string, locale: Locale): Promise<UserTag> {
  return apiRequest('/api/library/tags', {
    method: 'POST',
    json: { name, locale },
    schema: userTagSchema,
  });
}

export async function renameUserTag(tagId: string, name: string, locale: Locale): Promise<UserTag> {
  return apiRequest(`/api/library/tags/${encodeURIComponent(tagId)}`, {
    method: 'PATCH',
    json: { name, locale },
    schema: userTagSchema,
  });
}

export async function completeUserTagTranslations(tagId: string) {
  return apiRequest(`/api/library/tags/${encodeURIComponent(tagId)}/translations/complete`, {
    method: 'POST',
    schema: userTagTranslationsResultSchema,
  });
}

/**
 * Single owner for the three-outcome tag-translation feedback. Every caller
 * used to inline the same status → message → toast-kind mapping.
 */
export function reportTagTranslationResult(
  result: { status: 'completed' | 'incomplete' | 'provider_unavailable' },
  locale: Locale,
): void {
  const messageKey =
    result.status === 'completed'
      ? 'content.library.tagTranslationsComplete'
      : result.status === 'provider_unavailable'
        ? 'content.library.tagTranslationProviderUnavailable'
        : 'content.library.tagTranslationsMissing';
  const message = t(locale, messageKey);
  if (result.status === 'completed') {
    toast.success(message);
  } else if (result.status === 'provider_unavailable') {
    toast.error(message);
  } else {
    toast.info(message);
  }
}

/** Feedback for a rejected/failed translation request (as opposed to a partial result). */
export function reportTagTranslationFailure(locale: Locale): void {
  toast.error(t(locale, 'content.library.tagTranslationsMissing'));
}

export async function deleteUserTag(tagId: string): Promise<void> {
  await apiRequest(`/api/library/tags/${encodeURIComponent(tagId)}`, { method: 'DELETE', schema: z.undefined() });
}

export async function assignUserTag(workId: string, tagId: string): Promise<void> {
  await apiRequest(`/api/library/${encodeURIComponent(workId)}/tags/${encodeURIComponent(tagId)}`, {
    method: 'PUT',
    schema: z.undefined(),
  });
}

export async function unassignUserTag(workId: string, tagId: string): Promise<void> {
  await apiRequest(`/api/library/${encodeURIComponent(workId)}/tags/${encodeURIComponent(tagId)}`, {
    method: 'DELETE',
    schema: z.undefined(),
  });
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
