import { DICTIONARY_PROVIDER_FREE, DICTIONARY_PROVIDER_YOUDAO } from '@gloaming/shared/dictionary';

import { HTTP_STATUS } from '@/constants';
import { AppError } from '@/lib/errors/app-error';
import { ERROR_CODES } from '@/lib/errors/codes';
import { FreeDictionaryProvider } from '@/modules/dictionary/providers/free-dictionary';
import type { DictionaryProvider } from '@/modules/dictionary/providers/types';
import { YoudaoDictionaryProvider } from '@/modules/dictionary/providers/youdao-dictionary';

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
