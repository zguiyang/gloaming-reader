import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import type { Locale } from '@gloaming/i18n';
import {
  type PublicCategoryManagementItem,
  publicCategoryManagementItemSchema,
  type SourceRecordListData,
  sourceRecordListDataSchema,
} from '@gloaming/shared/discovery';
import { DEFAULT_PAGE, DEFAULT_SORT_ORDER } from '@gloaming/shared/pagination';

import {
  isAssignmentSearchReady,
  normalizeAssignmentSearchTerm,
  PUBLIC_CATEGORY_ASSIGNMENT_SEARCH_SIZE,
  PUBLIC_CATEGORY_HAS_ASSIGNMENTS_CODE,
  PUBLIC_CATEGORY_LIMIT_EXCEEDED_CODE,
  PUBLIC_CATEGORY_NAME_EXISTS_CODE,
  PUBLIC_CATEGORY_RECORD_PAGE_SIZE,
  PUBLIC_CATEGORY_RECORD_SORT_BY,
} from '@/features/admin/public-categories/public-categories-model';
import { apiRequest, ApiRequestError, formatApiError } from '@/lib/api-request';

/** PC-02 admin routes. Writes stay scoped to one category or one record/category pair. */
const CATEGORIES_PATH = '/api/admin/discovery/categories';
const SOURCE_RECORD_CATEGORY_PATH = '/api/admin/discovery/source-records';
/**
 * Candidate assignment searches the admin SourceRecord list so records hidden
 * from public Discover (unavailable, disabled source, or non-English) stay
 * assignable. The assign/unassign writes are admin-only too.
 */
const ADMIN_SOURCE_RECORDS_PATH = '/api/admin/discovery/source-records';

const managedCategoryListSchema = z.array(publicCategoryManagementItemSchema);

/** Admin completion outcome: the locales actually written by that pass. */
const categoryTranslationCompleteSchema = z.object({
  translatedLocales: z.array(z.string()),
});
export type CategoryTranslationCompleteResult = z.infer<typeof categoryTranslationCompleteSchema>;

export type CategoryRecordListParams = {
  page: number;
  pageSize?: number;
  q?: string;
};

export const publicCategoriesQueryKey = {
  all: ['admin', 'public-categories'] as const,
  list: () => [...publicCategoriesQueryKey.all, 'list'] as const,
  recordsAll: () => [...publicCategoriesQueryKey.all, 'records'] as const,
  records: (categoryId: string, params: CategoryRecordListParams) =>
    [...publicCategoriesQueryKey.recordsAll(), categoryId, params] as const,
  candidatesAll: () => [...publicCategoriesQueryKey.all, 'candidates'] as const,
  candidates: (term: string) => [...publicCategoriesQueryKey.candidatesAll(), term] as const,
};

/** `GET /api/admin/discovery/categories/:categoryId/source-records` query string. */
export function buildCategoryRecordListQuery(params: CategoryRecordListParams): string {
  const search = new URLSearchParams();
  search.set('page', String(params.page ?? DEFAULT_PAGE));
  search.set('pageSize', String(params.pageSize ?? PUBLIC_CATEGORY_RECORD_PAGE_SIZE));
  search.set('sortBy', PUBLIC_CATEGORY_RECORD_SORT_BY);
  search.set('sortOrder', DEFAULT_SORT_ORDER);
  const term = params.q?.trim();
  if (term) {
    search.set('q', term);
  }
  return search.toString();
}

/** `GET /api/admin/discovery/source-records` query string for assignable SourceRecord candidates. */
export function buildAssignmentCandidateQuery(term: string): string {
  const search = new URLSearchParams();
  search.set('page', String(DEFAULT_PAGE));
  search.set('pageSize', String(PUBLIC_CATEGORY_ASSIGNMENT_SEARCH_SIZE));
  search.set('sortBy', PUBLIC_CATEGORY_RECORD_SORT_BY);
  search.set('sortOrder', DEFAULT_SORT_ORDER);
  search.set('q', normalizeAssignmentSearchTerm(term));
  return search.toString();
}

export async function listManagedCategories(init?: { signal?: AbortSignal }): Promise<PublicCategoryManagementItem[]> {
  return apiRequest(CATEGORIES_PATH, { schema: managedCategoryListSchema, signal: init?.signal });
}

/** Manual create; the backend never needs a Provider and returns the stable category id. */
export async function createManagedCategory(input: {
  name: string;
  locale: Locale;
}): Promise<PublicCategoryManagementItem> {
  return apiRequest(CATEGORIES_PATH, {
    method: 'POST',
    schema: publicCategoryManagementItemSchema,
    json: input,
  });
}

/** Edit or add exactly one localized label; the category id and identity never change. */
export async function updateManagedCategoryLabel(
  categoryId: string,
  input: { name: string; locale: Locale },
): Promise<PublicCategoryManagementItem> {
  return apiRequest(`${CATEGORIES_PATH}/${encodeURIComponent(categoryId)}/labels`, {
    method: 'PATCH',
    schema: publicCategoryManagementItemSchema,
    json: input,
  });
}

/**
 * `POST /api/admin/discovery/categories/:categoryId/translations/complete` —
 * fill only the missing supported locales of one category on an explicit admin
 * click. The instance model is resolved server-side for this request only;
 * already-persisted (including manually edited) labels are never overwritten.
 */
export async function completeCategoryTranslations(categoryId: string): Promise<CategoryTranslationCompleteResult> {
  return apiRequest(`${CATEGORIES_PATH}/${encodeURIComponent(categoryId)}/translations/complete`, {
    method: 'POST',
    schema: categoryTranslationCompleteSchema,
  });
}

export async function listCategorySourceRecords(
  categoryId: string,
  params: CategoryRecordListParams,
  init?: { signal?: AbortSignal },
): Promise<SourceRecordListData> {
  const qs = buildCategoryRecordListQuery(params);
  return apiRequest(`${CATEGORIES_PATH}/${encodeURIComponent(categoryId)}/source-records?${qs}`, {
    schema: sourceRecordListDataSchema,
    signal: init?.signal,
  });
}

export async function searchAssignableSourceRecords(
  term: string,
  init?: { signal?: AbortSignal },
): Promise<SourceRecordListData> {
  const qs = buildAssignmentCandidateQuery(term);
  return apiRequest(`${ADMIN_SOURCE_RECORDS_PATH}?${qs}`, {
    schema: sourceRecordListDataSchema,
    signal: init?.signal,
  });
}

/** Explicit manual assignment for one pair; idempotent and capped by the service. */
export async function assignCategoryToSourceRecord(sourceRecordId: string, categoryId: string): Promise<void> {
  await apiRequest(
    `${SOURCE_RECORD_CATEGORY_PATH}/${encodeURIComponent(sourceRecordId)}/categories/${encodeURIComponent(categoryId)}`,
    {
      method: 'PUT',
      schema: z.void(),
    },
  );
}

/** Explicit manual removal for one pair; records suppression for that pair. */
export async function unassignCategoryFromSourceRecord(sourceRecordId: string, categoryId: string): Promise<void> {
  await apiRequest(
    `${SOURCE_RECORD_CATEGORY_PATH}/${encodeURIComponent(sourceRecordId)}/categories/${encodeURIComponent(categoryId)}`,
    {
      method: 'DELETE',
      schema: z.void(),
    },
  );
}

/** Hard delete of one unused category; the backend rejects a category that is still assigned. */
export async function deleteManagedCategory(categoryId: string): Promise<void> {
  await apiRequest(`${CATEGORIES_PATH}/${encodeURIComponent(categoryId)}`, {
    method: 'DELETE',
    schema: z.void(),
  });
}

/** True when a create/PATCH label collides with another category in the same locale. */
export function isCategoryNameCollisionError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === PUBLIC_CATEGORY_NAME_EXISTS_CODE;
}

/** True when the SourceRecord already holds the maximum number of categories. */
export function isCategoryAssignmentLimitError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === PUBLIC_CATEGORY_LIMIT_EXCEEDED_CODE;
}

/** True when the delete was refused because SourceRecords are still assigned to the category. */
export function isCategoryHasAssignmentsError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === PUBLIC_CATEGORY_HAS_ASSIGNMENTS_CODE;
}

export function useManagedCategoriesQuery() {
  return useQuery({
    queryKey: publicCategoriesQueryKey.list(),
    queryFn: ({ signal }) => listManagedCategories({ signal }),
  });
}

export function useCategorySourceRecordsQuery(categoryId: string | null, params: CategoryRecordListParams) {
  return useQuery({
    queryKey: publicCategoriesQueryKey.records(categoryId ?? '', params),
    queryFn: ({ signal }) => listCategorySourceRecords(categoryId!, params, { signal }),
    enabled: Boolean(categoryId),
    placeholderData: keepPreviousData,
  });
}

export function useAssignableSourceRecordsQuery(term: string) {
  const normalized = normalizeAssignmentSearchTerm(term);
  return useQuery({
    queryKey: publicCategoriesQueryKey.candidates(normalized),
    queryFn: ({ signal }) => searchAssignableSourceRecords(normalized, { signal }),
    enabled: isAssignmentSearchReady(normalized),
  });
}

export function useCreateManagedCategoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; locale: Locale }) => createManagedCategory(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: publicCategoriesQueryKey.list() });
    },
  });
}

export function useUpdateManagedCategoryLabelMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { categoryId: string; name: string; locale: Locale }) =>
      updateManagedCategoryLabel(input.categoryId, { name: input.name, locale: input.locale }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: publicCategoriesQueryKey.list() });
    },
  });
}

/** Refreshes the list so `missingLocales` reflects what the pass just wrote. */
export function useCompleteCategoryTranslationsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string) => completeCategoryTranslations(categoryId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: publicCategoriesQueryKey.list() });
    },
  });
}

export function useAssignCategoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { sourceRecordId: string; categoryId: string }) =>
      assignCategoryToSourceRecord(input.sourceRecordId, input.categoryId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: publicCategoriesQueryKey.recordsAll() });
      void queryClient.invalidateQueries({ queryKey: publicCategoriesQueryKey.candidatesAll() });
      void queryClient.invalidateQueries({ queryKey: publicCategoriesQueryKey.list() });
    },
  });
}

export function useUnassignCategoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { sourceRecordId: string; categoryId: string }) =>
      unassignCategoryFromSourceRecord(input.sourceRecordId, input.categoryId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: publicCategoriesQueryKey.recordsAll() });
      void queryClient.invalidateQueries({ queryKey: publicCategoriesQueryKey.candidatesAll() });
      void queryClient.invalidateQueries({ queryKey: publicCategoriesQueryKey.list() });
    },
  });
}

export function useDeleteManagedCategoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string) => deleteManagedCategory(categoryId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: publicCategoriesQueryKey.list() });
    },
  });
}

export const formatPublicCategoriesApiError = formatApiError;
