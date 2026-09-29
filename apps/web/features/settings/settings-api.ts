import { z } from 'zod';

import {
  type AiSettingKey,
  type CreateLlmModelBody,
  type CreateLlmProviderBody,
  llmAppSettingSchema,
  type LlmAppSettingView,
  type LlmModel,
  llmModelSchema,
  type LlmProvider,
  llmProviderSchema,
  type PutLlmAppSettingBody,
  type UpdateLlmModelBody,
  type UpdateLlmProviderBody,
} from '@gloaming/shared/llm';
import { type PutTtsConfigBody, ttsConfigSchema, type TtsConfigView } from '@gloaming/shared/tts';

import { apiRequest, formatApiError } from '@/lib/api-request';

const providerListSchema = z.array(llmProviderSchema);
const modelListSchema = z.array(llmModelSchema);
const settingListSchema = z.array(llmAppSettingSchema);

export const userSettingsQueryKey = {
  all: ['user-settings'] as const,
  providers: () => [...userSettingsQueryKey.all, 'llm', 'providers'] as const,
  models: () => [...userSettingsQueryKey.all, 'llm', 'models'] as const,
  settings: () => [...userSettingsQueryKey.all, 'llm', 'settings'] as const,
  tts: () => [...userSettingsQueryKey.all, 'tts'] as const,
};

export async function listUserLlmProviders(signal?: AbortSignal): Promise<LlmProvider[]> {
  return apiRequest('/api/settings/llm/providers', { schema: providerListSchema, signal });
}

export async function createUserLlmProvider(input: CreateLlmProviderBody): Promise<LlmProvider> {
  return apiRequest('/api/settings/llm/providers', { method: 'POST', schema: llmProviderSchema, json: input });
}

export async function updateUserLlmProvider(id: string, input: UpdateLlmProviderBody): Promise<LlmProvider> {
  return apiRequest(`/api/settings/llm/providers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    schema: llmProviderSchema,
    json: input,
  });
}

export async function deleteUserLlmProvider(id: string): Promise<void> {
  await apiRequest(`/api/settings/llm/providers/${encodeURIComponent(id)}`, { method: 'DELETE', schema: z.void() });
}

export async function listUserLlmModels(providerId: string, signal?: AbortSignal): Promise<LlmModel[]> {
  return apiRequest(`/api/settings/llm/models?providerId=${encodeURIComponent(providerId)}`, {
    schema: modelListSchema,
    signal,
  });
}

export async function createUserLlmModel(input: CreateLlmModelBody): Promise<LlmModel> {
  return apiRequest('/api/settings/llm/models', { method: 'POST', schema: llmModelSchema, json: input });
}

export async function updateUserLlmModel(id: string, input: UpdateLlmModelBody): Promise<LlmModel> {
  return apiRequest(`/api/settings/llm/models/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    schema: llmModelSchema,
    json: input,
  });
}

export async function deleteUserLlmModel(id: string): Promise<void> {
  await apiRequest(`/api/settings/llm/models/${encodeURIComponent(id)}`, { method: 'DELETE', schema: z.void() });
}

export async function listUserLlmSettings(signal?: AbortSignal): Promise<LlmAppSettingView[]> {
  return apiRequest('/api/settings/llm/settings', { schema: settingListSchema, signal });
}

export async function putUserLlmSetting(key: AiSettingKey, input: PutLlmAppSettingBody): Promise<LlmAppSettingView> {
  return apiRequest(`/api/settings/llm/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    schema: llmAppSettingSchema,
    json: input,
  });
}

export async function getUserTtsConfig(signal?: AbortSignal): Promise<TtsConfigView> {
  return apiRequest('/api/settings/tts/config', { schema: ttsConfigSchema, signal });
}

export async function putUserTtsConfig(input: PutTtsConfigBody): Promise<TtsConfigView> {
  return apiRequest('/api/settings/tts/config', { method: 'PUT', schema: ttsConfigSchema, json: input });
}

export const formatUserSettingsApiError = formatApiError;
