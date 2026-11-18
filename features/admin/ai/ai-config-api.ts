import { z } from 'zod';

import {
  type CreateLlmModelBody,
  type CreateLlmProviderBody,
  type FetchProviderModelsResult,
  fetchProviderModelsResultSchema,
  type LlmModel,
  llmModelSchema,
  type LlmProvider,
  llmProviderSchema,
  type ProviderBalanceResult,
  providerBalanceResultSchema,
  type TestLlmProviderBody,
  type TestLlmProviderResult,
  testLlmProviderResultSchema,
  type UpdateLlmModelBody,
  type UpdateLlmProviderBody,
} from '@/shared/llm';

import { apiRequest, formatApiError } from '@/lib/api-request';

const llmProviderListSchema = z.array(llmProviderSchema);
const llmModelListSchema = z.array(llmModelSchema);

export const adminLlmQueryKey = {
  all: ['admin-llm'] as const,
  providers: () => [...adminLlmQueryKey.all, 'providers'] as const,
  models: () => [...adminLlmQueryKey.all, 'models'] as const,
  wireRegistry: () => [...adminLlmQueryKey.all, 'wire-registry'] as const,
};

export async function listLlmProviders(init?: { signal?: AbortSignal }): Promise<LlmProvider[]> {
  return apiRequest('/api/admin/llm/providers', {
    schema: llmProviderListSchema,
    signal: init?.signal,
  });
}

export async function createLlmProvider(input: CreateLlmProviderBody): Promise<LlmProvider> {
  return apiRequest('/api/admin/llm/providers', {
    method: 'POST',
    schema: llmProviderSchema,
    json: input,
  });
}

export async function updateLlmProvider(id: string, input: UpdateLlmProviderBody): Promise<LlmProvider> {
  return apiRequest(`/api/admin/llm/providers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    schema: llmProviderSchema,
    json: input,
  });
}

export async function deleteLlmProvider(id: string): Promise<void> {
  await apiRequest(`/api/admin/llm/providers/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    schema: z.void(),
  });
}

export async function testLlmProvider(id: string, input: TestLlmProviderBody = {}): Promise<TestLlmProviderResult> {
  return apiRequest(`/api/admin/llm/providers/${encodeURIComponent(id)}/test`, {
    method: 'POST',
    schema: testLlmProviderResultSchema,
    json: input,
  });
}

export async function fetchLlmProviderModels(id: string): Promise<FetchProviderModelsResult> {
  return apiRequest(`/api/admin/llm/providers/${encodeURIComponent(id)}/fetch-models`, {
    method: 'POST',
    schema: fetchProviderModelsResultSchema,
  });
}

export async function queryLlmProviderBalance(id: string): Promise<ProviderBalanceResult> {
  return apiRequest(`/api/admin/llm/providers/${encodeURIComponent(id)}/balance`, {
    method: 'POST',
    schema: providerBalanceResultSchema,
  });
}

export async function listLlmModels(
  params?: { providerId?: string },
  init?: { signal?: AbortSignal },
): Promise<LlmModel[]> {
  const search = new URLSearchParams();
  if (params?.providerId) {
    search.set('providerId', params.providerId);
  }
  const qs = search.toString();
  return apiRequest(`/api/admin/llm/models${qs ? `?${qs}` : ''}`, {
    schema: llmModelListSchema,
    signal: init?.signal,
  });
}

export async function createLlmModel(input: CreateLlmModelBody): Promise<LlmModel> {
  return apiRequest('/api/admin/llm/models', {
    method: 'POST',
    schema: llmModelSchema,
    json: input,
  });
}

export async function updateLlmModel(id: string, input: UpdateLlmModelBody): Promise<LlmModel> {
  return apiRequest(`/api/admin/llm/models/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    schema: llmModelSchema,
    json: input,
  });
}

export async function deleteLlmModel(id: string): Promise<void> {
  await apiRequest(`/api/admin/llm/models/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    schema: z.void(),
  });
}

export const formatAdminLlmApiError = formatApiError;
