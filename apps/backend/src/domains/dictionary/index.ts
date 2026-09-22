export {
  DICTIONARY_CONFIG_ID,
  getDictionaryConfig,
  loadConfigRow,
  putDictionaryConfig,
} from '@/domains/dictionary/config/service';
export { persistGenericDictionaryEntry, toGenericDictionaryEntry } from '@/domains/dictionary/lookup/generic-entry';
export type { LookupWordOptions } from '@/domains/dictionary/lookup/index';
export { lookupWord, testDictionary } from '@/domains/dictionary/lookup/index';
export type { DictionaryProviderErrorPhase } from '@/domains/dictionary/providers/errors';
export {
  appErrorFromUpstreamDictionaryStatus,
  isTransientDictionaryProviderFailure,
  mapUpstreamDictionaryHttpStatus,
  rethrowClassifiedDictionaryProviderError,
} from '@/domains/dictionary/providers/errors';
export { FreeDictionaryProvider } from '@/domains/dictionary/providers/free-dictionary';
export {
  getDictionaryProvider,
  isDictionaryProviderRegistered,
  youdaoDictionaryProvider,
} from '@/domains/dictionary/providers/registry';
export type {
  DictionaryProvider,
  ProviderLookupOptions,
  RawProviderResult,
} from '@/domains/dictionary/providers/types';
export { YoudaoDictionaryProvider } from '@/domains/dictionary/providers/youdao-dictionary';
export { dictionaryRoutes } from '@/domains/dictionary/routes';
