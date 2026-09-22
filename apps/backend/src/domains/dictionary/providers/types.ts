import type { DictionaryEntry } from '@gloaming/shared/dictionary';

export type ProviderLookupOptions = {
  customEndpoint?: string | null;
  apiKey?: string | null;
  timeoutMs?: number;
};

export type RawProviderResult = {
  entry: DictionaryEntry;
  rawData: unknown;
};

export interface DictionaryProvider {
  readonly id: string;
  lookup(word: string, options?: ProviderLookupOptions): Promise<RawProviderResult | null>;
}
