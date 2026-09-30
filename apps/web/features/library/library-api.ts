import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { type LibraryData, type UserTag, userTagListSchema, userTagSchema } from '@gloaming/shared/library';
import {
  EPUB_UPLOAD_MAX_BYTES,
  personalWorkDeleteResultSchema,
  type PersonalWorkUpdate,
  type PersonalWorkUpdateResult,
  personalWorkUpdateResultSchema,
  type PersonalWorkUploadResult,
  personalWorkUploadResultSchema,
} from '@gloaming/shared/works';

import { getLibrary } from '@/features/library/library-public';
import { apiRequest, formatApiError } from '@/lib/api-request';

export const libraryQueryKey = {
  all: ['library'] as const,
  tags: ['library', 'tags'] as const,
};

export function useUserTagsQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: libraryQueryKey.tags,
    queryFn: ({ signal }) => apiRequest('/api/library/tags', { schema: userTagListSchema, signal }),
    enabled: options?.enabled ?? true,
  });
}

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

export async function createUserTag(name: string): Promise<UserTag> {
  return apiRequest('/api/library/tags', {
    method: 'POST',
    json: { name },
    schema: userTagSchema,
  });
}

export async function renameUserTag(tagId: string, name: string): Promise<UserTag> {
  return apiRequest(`/api/library/tags/${encodeURIComponent(tagId)}`, {
    method: 'PATCH',
    json: { name },
    schema: userTagSchema,
  });
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
