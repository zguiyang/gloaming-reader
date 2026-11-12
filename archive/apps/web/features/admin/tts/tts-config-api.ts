import { z } from 'zod';

import {
  type PutTtsConfigBody,
  type TestTtsBody,
  type TestTtsResult,
  testTtsResultSchema,
  ttsConfigSchema,
  type TtsConfigView,
  type TtsVoicePreset,
  ttsVoicePresetSchema,
} from '@gloaming/shared/tts';

import { apiRequest, formatApiError } from '@/lib/api-request';

const ttsVoicePresetListSchema = z.array(ttsVoicePresetSchema);

export const adminTtsQueryKey = {
  all: ['admin-tts'] as const,
  config: () => [...adminTtsQueryKey.all, 'config'] as const,
  presets: () => [...adminTtsQueryKey.all, 'presets'] as const,
};

export async function getTtsConfig(init?: { signal?: AbortSignal }): Promise<TtsConfigView> {
  return apiRequest('/api/admin/tts/config', {
    schema: ttsConfigSchema,
    signal: init?.signal,
  });
}

export async function putTtsConfig(input: PutTtsConfigBody): Promise<TtsConfigView> {
  return apiRequest('/api/admin/tts/config', {
    method: 'PUT',
    schema: ttsConfigSchema,
    json: input,
  });
}

export async function listTtsVoicePresets(init?: { signal?: AbortSignal }): Promise<TtsVoicePreset[]> {
  return apiRequest('/api/admin/tts/voice-presets', {
    schema: ttsVoicePresetListSchema,
    signal: init?.signal,
  });
}

export async function testTts(input: TestTtsBody): Promise<TestTtsResult> {
  return apiRequest('/api/admin/tts/test', {
    method: 'POST',
    schema: testTtsResultSchema,
    json: input,
  });
}

export function formatAdminTtsApiError(error: unknown): string {
  return formatApiError(error);
}
