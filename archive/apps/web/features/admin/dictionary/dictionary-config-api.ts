import {
  dictionaryConfigSchema,
  type DictionaryConfigView,
  type PutDictionaryConfigBody,
  type TestDictionaryBody,
  type TestDictionaryResult,
  testDictionaryResultSchema,
} from '@gloaming/shared/dictionary';

import { apiRequest, formatApiError } from '@/lib/api-request';

export const adminDictionaryQueryKey = {
  all: ['admin-dictionary'] as const,
  config: () => [...adminDictionaryQueryKey.all, 'config'] as const,
};

export async function getDictionaryConfig(init?: { signal?: AbortSignal }): Promise<DictionaryConfigView> {
  return apiRequest('/api/admin/dictionary/config', {
    schema: dictionaryConfigSchema,
    signal: init?.signal,
  });
}

export async function putDictionaryConfig(input: PutDictionaryConfigBody): Promise<DictionaryConfigView> {
  return apiRequest('/api/admin/dictionary/config', {
    method: 'PUT',
    schema: dictionaryConfigSchema,
    json: input,
  });
}

export async function testDictionary(input: TestDictionaryBody): Promise<TestDictionaryResult> {
  return apiRequest('/api/admin/dictionary/test', {
    method: 'POST',
    schema: testDictionaryResultSchema,
    json: input,
  });
}

export function formatAdminDictionaryApiError(error: unknown): string {
  return formatApiError(error);
}
