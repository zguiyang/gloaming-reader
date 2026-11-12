import { DICTIONARY_PROVIDER_FREE, DICTIONARY_PROVIDER_YOUDAO } from '@gloaming/shared/dictionary';

import { FreeDictionaryProvider } from '@/domains/dictionary/providers/free-dictionary';
import type { DictionaryProvider } from '@/domains/dictionary/providers/types';
import { YoudaoDictionaryProvider } from '@/domains/dictionary/providers/youdao-dictionary';
import { HTTP_STATUS } from '@/shared/constants';
import { AppError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

const freeDictionaryProvider = new FreeDictionaryProvider();
export const youdaoDictionaryProvider = new YoudaoDictionaryProvider();

const providerRegistry = new Map<string, DictionaryProvider>([
  [DICTIONARY_PROVIDER_YOUDAO, youdaoDictionaryProvider],
  [DICTIONARY_PROVIDER_FREE, freeDictionaryProvider],
]);

export function isDictionaryProviderRegistered(providerId: string): boolean {
  return providerRegistry.has(providerId);
}

export function getDictionaryProvider(providerId: string): DictionaryProvider {
  const provider = providerRegistry.get(providerId);
  if (!provider) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.DICTIONARY.PROVIDER_NOT_IMPLEMENTED, { providerId });
  }
  return provider;
}
