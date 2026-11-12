export {
  DICTIONARY_CONFIG_ID,
  getDictionaryConfig,
  loadConfigRow,
  putDictionaryConfig,
} from '@/server/domains/dictionary/config/service';
export {
  persistGenericDictionaryEntry,
  toGenericDictionaryEntry,
} from '@/server/domains/dictionary/lookup/generic-entry';
export type { LookupWordOptions } from '@/server/domains/dictionary/lookup/service';
export { lookupWord, testDictionary } from '@/server/domains/dictionary/lookup/service';
export type { DictionaryProviderErrorPhase } from '@/server/domains/dictionary/providers/errors';
export {
  appErrorFromUpstreamDictionaryStatus,
  isTransientDictionaryProviderFailure,
  mapUpstreamDictionaryHttpStatus,
  rethrowClassifiedDictionaryProviderError,
} from '@/server/domains/dictionary/providers/errors';
export { FreeDictionaryProvider } from '@/server/domains/dictionary/providers/free-dictionary';
export {
  getDictionaryProvider,
  isDictionaryProviderRegistered,
  youdaoDictionaryProvider,
} from '@/server/domains/dictionary/providers/registry';
export type {
  DictionaryProvider,
  ProviderLookupOptions,
  RawProviderResult,
} from '@/server/domains/dictionary/providers/types';
export { YoudaoDictionaryProvider } from '@/server/domains/dictionary/providers/youdao-dictionary';
