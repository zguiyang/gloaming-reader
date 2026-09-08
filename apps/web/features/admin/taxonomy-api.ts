import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import type {
  CreateTaxonomyBody,
  TaxonomyCleanupResult,
  TaxonomyItem,
  TaxonomyKind,
  TaxonomyListQuery,
  UpdateTaxonomyBody,
} from '@gloaming/shared/taxonomy';
import { taxonomyCleanupResultSchema, taxonomyItemSchema, taxonomyListDataSchema } from '@gloaming/shared/taxonomy';

import { apiRequest, formatApiError } from '@/lib/api-request';

export const taxonomyQueryKey = {
  all: ['admin', 'taxonomy'] as const,
  list: (kind: TaxonomyKind, query: TaxonomyListQuery) => [...taxonomyQueryKey.all, kind, query] as const,
};

export async function listTaxonomy(
  kind: TaxonomyKind,
  query: TaxonomyListQuery = {},
  init?: { signal?: AbortSignal },
): Promise<TaxonomyItem[]> {
  const search = new URLSearchParams();
  if (query.search) search.set('search', query.search);
  const qs = search.toString();
  const data = await apiRequest(`/api/admin/taxonomy/${kind}${qs ? `?${qs}` : ''}`, {
    schema: taxonomyListDataSchema,
    signal: init?.signal,
  });
  return data.items;
}

export async function createTaxonomyItem(kind: TaxonomyKind, body: CreateTaxonomyBody): Promise<TaxonomyItem> {
  return apiRequest(`/api/admin/taxonomy/${kind}`, {
    method: 'POST',
    json: body,
    schema: taxonomyItemSchema,
  });
}

export async function updateTaxonomyItem(
  kind: TaxonomyKind,
  id: string,
  body: UpdateTaxonomyBody,
): Promise<TaxonomyItem> {
  return apiRequest(`/api/admin/taxonomy/${kind}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    json: body,
    schema: taxonomyItemSchema,
  });
}

export async function deleteTaxonomyItem(kind: TaxonomyKind, id: string) {
  await apiRequest(`/api/admin/taxonomy/${kind}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    schema: z.void(),
  });
}

export async function cleanupUnusedTaxonomy(kind: 'tag' | 'category'): Promise<TaxonomyCleanupResult> {
  return apiRequest(`/api/admin/taxonomy/${kind}/cleanup`, {
    method: 'POST',
    schema: taxonomyCleanupResultSchema,
  });
}

/** Shared query for pickers and the admin page — keeps one cache per kind. */
export function useTaxonomyQuery(kind: TaxonomyKind, query: TaxonomyListQuery = {}) {
  return useQuery({
    queryKey: taxonomyQueryKey.list(kind, query),
    queryFn: ({ signal }) => listTaxonomy(kind, query, { signal }),
  });
}

export function useInvalidateTaxonomy() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: taxonomyQueryKey.all });
  };
}

export function useCreateTaxonomy(kind: TaxonomyKind) {
  const invalidate = useInvalidateTaxonomy();
  return useMutation({
    mutationFn: (body: CreateTaxonomyBody) => createTaxonomyItem(kind, body),
    onSuccess: () => void invalidate(),
  });
}

export function useUpdateTaxonomy(kind: TaxonomyKind) {
  const invalidate = useInvalidateTaxonomy();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateTaxonomyBody }) => updateTaxonomyItem(kind, id, body),
    onSuccess: () => void invalidate(),
  });
}

export function useDeleteTaxonomy(kind: TaxonomyKind) {
  const invalidate = useInvalidateTaxonomy();
  return useMutation({
    mutationFn: (id: string) => deleteTaxonomyItem(kind, id),
    onSuccess: () => void invalidate(),
  });
}

export function useCleanupTaxonomy() {
  const invalidate = useInvalidateTaxonomy();
  return useMutation({
    mutationFn: (kind: 'tag' | 'category') => cleanupUnusedTaxonomy(kind),
    onSuccess: () => void invalidate(),
  });
}

export const formatTaxonomyApiError = formatApiError;
