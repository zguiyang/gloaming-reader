export { DICTIONARY_CONFIG_ID, getDictionaryConfig, putDictionaryConfig } from './config';
export { toGenericDictionaryEntry } from './generic-entry';
export type { LookupWordOptions } from './lookup';
export { lookupWord, testDictionary } from './lookup';
export { getDictionaryProvider } from './provider-registry';
export * from './providers/free-dictionary';
export { dictionaryRoutes } from './route';
export type { DictionaryProvider, ProviderLookupOptions, RawProviderResult } from './types';
export { validateLookupDictionaryQuery, validatePutDictionaryConfig, validateTestDictionary } from './validator';
