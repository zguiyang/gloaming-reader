import { z } from 'zod';

export const DICTIONARY_PROVIDER_YOUDAO = 'youdao' as const;
export const DICTIONARY_PROVIDER_FREE = 'free_dictionary' as const;
export const DICTIONARY_PROVIDER_CUSTOM = 'custom' as const;

export const dictionaryProviderValues = [
  DICTIONARY_PROVIDER_YOUDAO,
  DICTIONARY_PROVIDER_FREE,
  DICTIONARY_PROVIDER_CUSTOM,
] as const;
export type DictionaryProviderType = (typeof dictionaryProviderValues)[number];

export const DICTIONARY_PROVIDER_LABELS: Record<string, string> = {
  [DICTIONARY_PROVIDER_YOUDAO]: '有道词典开放接口（中文释义 + 英美发音 · 国内极速推荐）',
  [DICTIONARY_PROVIDER_FREE]: 'Free Dictionary API（英文骨架 · 海外直连/需代理）',
  [DICTIONARY_PROVIDER_CUSTOM]: '自定义 REST 兼容接口',
};

export const DEFAULT_DICTIONARY_CONFIG = {
  provider: DICTIONARY_PROVIDER_YOUDAO,
  isEnabled: true,
  enableAiEnrichment: true,
  customEndpoint: null,
  timeoutMs: 5000,
  cacheTtlDays: 30,
} as const;

export const dictionaryPhoneticSchema = z.object({
  text: z.string().optional(),
  audio: z.string().optional(),
  sourceUrl: z.string().optional(),
  role: z.enum(['us', 'uk', 'general']).optional(),
});

export type DictionaryPhonetic = z.infer<typeof dictionaryPhoneticSchema>;

export const dictionaryDefinitionSchema = z.object({
  definition: z.string(),
  definitionZh: z.string().optional(),
  example: z.string().optional(),
  exampleZh: z.string().optional(),
  synonyms: z.array(z.string()).optional(),
  antonyms: z.array(z.string()).optional(),
});

export type DictionaryDefinition = z.infer<typeof dictionaryDefinitionSchema>;

export const dictionaryMeaningSchema = z.object({
  partOfSpeech: z.string(),
  definitions: z.array(dictionaryDefinitionSchema),
  synonyms: z.array(z.string()).optional(),
  antonyms: z.array(z.string()).optional(),
});

export type DictionaryMeaning = z.infer<typeof dictionaryMeaningSchema>;

export const dictionaryContextExampleSchema = z.object({
  sentence: z.string(),
  sentenceZh: z.string().optional(),
  note: z.string().optional(),
  workId: z.string().optional(),
  partId: z.string().optional(),
  workTitle: z.string().optional(),
});

export type DictionaryContextExample = z.infer<typeof dictionaryContextExampleSchema>;

export const dictionaryEntrySchema = z.object({
  id: z.string().optional(),
  word: z.string(),
  phonetics: z.array(dictionaryPhoneticSchema),
  meanings: z.array(dictionaryMeaningSchema),
  contextExamples: z.array(dictionaryContextExampleSchema).optional(),
  source: z.string().optional(),
  fromCache: z.boolean().optional(),
  createdAt: z.union([z.string(), z.date()]).optional(),
  updatedAt: z.union([z.string(), z.date()]).nullable().optional(),
});

export type DictionaryEntry = z.infer<typeof dictionaryEntrySchema>;

export const dictionaryConfigSchema = z.object({
  configured: z.boolean(),
  provider: z.string(),
  isEnabled: z.boolean(),
  enableAiEnrichment: z.boolean(),
  customEndpoint: z.string().nullable(),
  apiKeySet: z.boolean(),
  apiKeyMasked: z.string().nullable(),
  timeoutMs: z.number().int().positive(),
  cacheTtlDays: z.number().int().positive(),
  updatedAt: z.union([z.string(), z.date()]).nullable(),
});

export type DictionaryConfigView = z.infer<typeof dictionaryConfigSchema>;

export const putDictionaryConfigBodySchema = z.object({
  provider: z.string().trim().min(1).max(64),
  isEnabled: z.boolean(),
  enableAiEnrichment: z.boolean(),
  customEndpoint: z.string().trim().max(500).optional().nullable(),
  apiKey: z.string().trim().max(2000).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
  cacheTtlDays: z.number().int().min(1).max(365).optional(),
});

export type PutDictionaryConfigBody = z.infer<typeof putDictionaryConfigBodySchema>;

export const testDictionaryBodySchema = z.object({
  word: z.string().trim().min(1).max(100),
  contextSentence: z.string().trim().max(1000).optional(),
  workId: z.string().trim().optional(),
  partId: z.string().trim().optional(),
});

export type TestDictionaryBody = z.infer<typeof testDictionaryBodySchema>;

export const testDictionaryResultSchema = z.object({
  ok: z.literal(true),
  latencyMs: z.number().int().nonnegative(),
  provider: z.string(),
  entry: dictionaryEntrySchema,
});

export type TestDictionaryResult = z.infer<typeof testDictionaryResultSchema>;

export const lookupDictionaryQuerySchema = z.object({
  word: z.string().trim().min(1).max(100),
  contextSentence: z.string().trim().max(1000).optional(),
  workId: z.string().trim().optional(),
  partId: z.string().trim().optional(),
});

export type LookupDictionaryQuery = z.infer<typeof lookupDictionaryQuerySchema>;

export const lookupDictionaryResultSchema = z.object({
  ok: z.literal(true),
  entry: dictionaryEntrySchema,
});

export type LookupDictionaryResult = z.infer<typeof lookupDictionaryResultSchema>;
