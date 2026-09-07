import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import {
  adminWorkListDataSchema,
  type AdminWorkListQuery,
  adminWorkSchema,
  type CheckEpubWorkReuseBody,
  createEpubWorkResultSchema,
  epubReuseResultSchema,
  type RetryWorkflowBody,
  type UpdateWorkBody,
  type WorkflowStep,
} from '@gloaming/shared';

import {
  type AdminWorkSummaryView,
  type AdminWorkView,
  normalizeAdminWork,
  normalizeAdminWorkSummary,
} from '@/features/works-http';
import { apiRequest, formatApiError } from '@/lib/api-request';

export const adminWorksQueryKey = {
  all: ['admin', 'works'] as const,
  list: (query: Partial<AdminWorkListQuery>) => [...adminWorksQueryKey.all, 'list', query] as const,
  detail: (id: string) => [...adminWorksQueryKey.all, 'detail', id] as const,
};

export async function listAdminWorks(
  query: Partial<AdminWorkListQuery> = {},
  init?: { signal?: AbortSignal },
): Promise<{ items: AdminWorkSummaryView[]; pagination: { total: number; page: number; pageSize: number } }> {
  const search = new URLSearchParams();
  if (query.page) search.set('page', String(query.page));
  if (query.pageSize) search.set('pageSize', String(query.pageSize));
  if (query.status) search.set('status', query.status);
  const qs = search.toString();
  const data = await apiRequest(`/api/admin/works${qs ? `?${qs}` : ''}`, {
    schema: adminWorkListDataSchema,
    signal: init?.signal,
  });
  return { ...data, items: data.items.map(normalizeAdminWorkSummary) };
}

export async function getAdminWork(id: string, init?: { signal?: AbortSignal }): Promise<AdminWorkView> {
  const raw = await apiRequest(`/api/admin/works/${encodeURIComponent(id)}`, {
    schema: adminWorkSchema,
    signal: init?.signal,
  });
  return normalizeAdminWork(raw);
}

export async function uploadAdminEpub(file: File, init?: { signal?: AbortSignal }) {
  const formData = new FormData();
  formData.append('file', file);
  return apiRequest('/api/admin/works/epub', {
    method: 'POST',
    body: formData,
    schema: createEpubWorkResultSchema,
    signal: init?.signal,
  });
}

/** Instant-upload dedupe lookup — creates the work when the file hash already exists. */
export async function checkEpubWorkReuse(body: CheckEpubWorkReuseBody, init?: { signal?: AbortSignal }) {
  return apiRequest('/api/admin/works/epub/reuse', {
    method: 'POST',
    json: body,
    schema: epubReuseResultSchema,
    signal: init?.signal,
  });
}

export async function updateAdminWork(id: string, body: UpdateWorkBody, init?: { signal?: AbortSignal }) {
  const raw = await apiRequest(`/api/admin/works/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    schema: adminWorkSchema,
    json: body,
    signal: init?.signal,
  });
  return normalizeAdminWork(raw);
}

export async function publishAdminWork(id: string, init?: { signal?: AbortSignal }) {
  const raw = await apiRequest(`/api/admin/works/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
    schema: adminWorkSchema,
    signal: init?.signal,
  });
  return normalizeAdminWork(raw);
}

export async function unpublishAdminWork(id: string, init?: { signal?: AbortSignal }) {
  const raw = await apiRequest(`/api/admin/works/${encodeURIComponent(id)}/unpublish`, {
    method: 'POST',
    schema: adminWorkSchema,
    signal: init?.signal,
  });
  return normalizeAdminWork(raw);
}

/**
 * Workflow retry / re-run — without `step` it resumes from the failed step;
 * with `step` it re-runs that step and everything after it.
 */
export async function retryAdminWorkflow(id: string, step?: WorkflowStep, init?: { signal?: AbortSignal }) {
  const raw = await apiRequest(`/api/admin/works/${encodeURIComponent(id)}/workflow/retry`, {
    method: 'POST',
    schema: adminWorkSchema,
    ...(step ? { json: { step } satisfies RetryWorkflowBody } : {}),
    signal: init?.signal,
  });
  return normalizeAdminWork(raw);
}

export async function deleteAdminWork(id: string, init?: { signal?: AbortSignal }) {
  await apiRequest(`/api/admin/works/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    schema: z.void(),
    signal: init?.signal,
  });
}

export function useAdminWorksListQuery(query: Partial<AdminWorkListQuery> = {}) {
  return useQuery({
    queryKey: adminWorksQueryKey.list(query),
    queryFn: ({ signal }) => listAdminWorks(query, { signal }),
  });
}

export function useAdminWorkQuery(id: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: adminWorksQueryKey.detail(id),
    queryFn: ({ signal }) => getAdminWork(id, { signal }),
    enabled: options?.enabled ?? Boolean(id),
  });
}

export function useInvalidateAdminWorks() {
  const queryClient = useQueryClient();
  return async (id?: string) => {
    await queryClient.invalidateQueries({ queryKey: adminWorksQueryKey.all });
    if (id) {
      await queryClient.invalidateQueries({ queryKey: adminWorksQueryKey.detail(id) });
    }
  };
}

export const formatWorksApiError = formatApiError;
