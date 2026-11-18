import { z } from 'zod';

import {
  type AiSettingKey,
  llmAppSettingSchema,
  type LlmAppSettingView,
  llmModelSchema,
  llmProviderSchema,
  type PutLlmAppSettingBody,
} from '@/shared/llm';
import { type PutUserTtsVoicesBody, type UserTtsVoicesView, userTtsVoicesSchema } from '@/shared/tts';

import { apiRequest, formatApiError } from '@/lib/api-request';

const settingListSchema = z.array(llmAppSettingSchema);
const availableModelsSchema = z.object({
  providers: z.array(llmProviderSchema),
  models: z.array(llmModelSchema),
});

export type AvailableInstanceModels = z.infer<typeof availableModelsSchema>;

export const userSettingsQueryKey = {
  all: ['user-settings'] as const,
  settings: () => [...userSettingsQueryKey.all, 'llm', 'settings'] as const,
  availableModels: () => [...userSettingsQueryKey.all, 'llm', 'available-models'] as const,
  tts: () => [...userSettingsQueryKey.all, 'tts'] as const,
};

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

export async function listAvailableInstanceModels(signal?: AbortSignal): Promise<AvailableInstanceModels> {
  return apiRequest('/api/settings/llm/available-models', { schema: availableModelsSchema, signal });
}

export async function getUserTtsVoices(signal?: AbortSignal): Promise<UserTtsVoicesView> {
  return apiRequest('/api/settings/tts/config', { schema: userTtsVoicesSchema, signal });
}

export async function putUserTtsVoices(input: PutUserTtsVoicesBody): Promise<UserTtsVoicesView> {
  return apiRequest('/api/settings/tts/config', { method: 'PUT', schema: userTtsVoicesSchema, json: input });
}

export const formatUserSettingsApiError = formatApiError;
