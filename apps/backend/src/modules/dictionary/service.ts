import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  dictionaryConfig as dictionaryConfigTable,
  dictionaryEntry as dictionaryEntryTable,
  readingWork,
} from '@gloaming/db';
import {
  DEFAULT_DICTIONARY_CONFIG,
  DICTIONARY_PROVIDER_FREE,
  DICTIONARY_PROVIDER_YOUDAO,
  type DictionaryConfigView,
  type DictionaryContextExample,
  type DictionaryDefinition,
  type DictionaryEntry,
  type DictionaryMeaning,
  type PutDictionaryConfigBody,
  type TestDictionaryBody,
  type TestDictionaryResult,
} from '@gloaming/shared/dictionary';

import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { AppError } from '@/lib/errors';
import { decryptApiKey, encryptApiKey, maskApiKey } from '@/lib/llm';
import { rootLogger } from '@/lib/logger';
import { getRedis } from '@/lib/redis';
import { invokeAi } from '@/modules/ai/service';
import { isTransientDictionaryProviderFailure } from '@/modules/dictionary/provider-errors';
import { FreeDictionaryProvider } from '@/modules/dictionary/providers/free-dictionary';
import { YoudaoDictionaryProvider } from '@/modules/dictionary/providers/youdao-dictionary';
import type { DictionaryProvider, RawProviderResult } from '@/modules/dictionary/types';

export const DICTIONARY_CONFIG_ID = 'default';

const logger = rootLogger.child({ module: 'DictionaryService' });

type DictionaryConfigRow = typeof dictionaryConfigTable.$inferSelect;

const REDIS_CONFIG_KEY = 'gloaming:dictionary:config:default';
const REDIS_CONFIG_TTL_SECONDS = 3600;

function wordCacheKey(word: string): string {
  return `gloaming:dictionary:v1:word:${encodeURIComponent(word.trim().toLowerCase())}`;
}

const freeDictionaryProvider = new FreeDictionaryProvider();
const youdaoDictionaryProvider = new YoudaoDictionaryProvider();

const providerRegistry = new Map<string, DictionaryProvider>([
  [DICTIONARY_PROVIDER_YOUDAO, youdaoDictionaryProvider],
  [DICTIONARY_PROVIDER_FREE, freeDictionaryProvider],
]);

export function getDictionaryProvider(providerId: string): DictionaryProvider {
  const provider = providerRegistry.get(providerId);
  if (!provider) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, `词典 Provider「${providerId}」尚未实现或不支持`);
  }
  return provider;
}

function emptyConfigView(): DictionaryConfigView {
  return {
    configured: false,
    provider: DEFAULT_DICTIONARY_CONFIG.provider,
    isEnabled: DEFAULT_DICTIONARY_CONFIG.isEnabled,
    enableAiEnrichment: DEFAULT_DICTIONARY_CONFIG.enableAiEnrichment,
    customEndpoint: DEFAULT_DICTIONARY_CONFIG.customEndpoint,
    apiKeySet: false,
    apiKeyMasked: null,
    timeoutMs: DEFAULT_DICTIONARY_CONFIG.timeoutMs,
    cacheTtlDays: DEFAULT_DICTIONARY_CONFIG.cacheTtlDays,
    updatedAt: null,
  };
}

function toConfigView(row: DictionaryConfigRow): DictionaryConfigView {
  let apiKeyMasked: string | null = null;
  if (row.apiKeyCiphertext) {
    try {
      apiKeyMasked = maskApiKey(decryptApiKey(row.apiKeyCiphertext));
    } catch {
      apiKeyMasked = '****';
    }
  }

  return {
    configured: true,
    provider: row.provider,
    isEnabled: row.isEnabled,
    enableAiEnrichment: row.enableAiEnrichment,
    customEndpoint: row.customEndpoint,
    apiKeySet: Boolean(row.apiKeyCiphertext),
    apiKeyMasked,
    timeoutMs: row.timeoutMs,
    cacheTtlDays: row.cacheTtlDays,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

async function loadConfigRow(): Promise<DictionaryConfigRow | null> {
  const rows = await db
    .select()
    .from(dictionaryConfigTable)
    .where(eq(dictionaryConfigTable.id, DICTIONARY_CONFIG_ID))
    .limit(1);
  return rows[0] ?? null;
}

export async function getDictionaryConfig(): Promise<DictionaryConfigView> {
  try {
    const cached = await getRedis().get(REDIS_CONFIG_KEY);
    if (cached) {
      return JSON.parse(cached) as DictionaryConfigView;
    }
  } catch (err) {
    logger.warn({ err }, 'Redis dictionary config cache read failed');
  }

  const row = await loadConfigRow();
  const view = row ? toConfigView(row) : emptyConfigView();

  try {
    await getRedis().set(REDIS_CONFIG_KEY, JSON.stringify(view), 'EX', REDIS_CONFIG_TTL_SECONDS);
  } catch (err) {
    logger.warn({ err }, 'Redis dictionary config cache write failed');
  }

  return view;
}

export async function putDictionaryConfig(body: PutDictionaryConfigBody): Promise<DictionaryConfigView> {
  const providerId = body.provider.trim();
  if (!providerRegistry.has(providerId)) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, `词典 Provider「${providerId}」尚未实现或不支持，无法保存`);
  }

  const existing = await loadConfigRow();

  let apiKeyCiphertext: string | null = null;
  if (body.apiKey?.trim()) {
    apiKeyCiphertext = encryptApiKey(body.apiKey.trim());
  } else if (existing?.apiKeyCiphertext) {
    apiKeyCiphertext = existing.apiKeyCiphertext;
  }

  const values = {
    id: DICTIONARY_CONFIG_ID,
    provider: providerId,
    isEnabled: body.isEnabled,
    enableAiEnrichment: body.enableAiEnrichment,
    customEndpoint: body.customEndpoint?.trim() || null,
    apiKeyCiphertext,
    timeoutMs: body.timeoutMs ?? DEFAULT_DICTIONARY_CONFIG.timeoutMs,
    cacheTtlDays: body.cacheTtlDays ?? DEFAULT_DICTIONARY_CONFIG.cacheTtlDays,
    updatedAt: new Date(),
  };

  const [savedRow] = await db
    .insert(dictionaryConfigTable)
    .values(values)
    .onConflictDoUpdate({
      target: dictionaryConfigTable.id,
      set: {
        provider: values.provider,
        isEnabled: values.isEnabled,
        enableAiEnrichment: values.enableAiEnrichment,
        customEndpoint: values.customEndpoint,
        apiKeyCiphertext: values.apiKeyCiphertext,
        timeoutMs: values.timeoutMs,
        cacheTtlDays: values.cacheTtlDays,
        updatedAt: values.updatedAt,
      },
    })
    .returning();

  const view = toConfigView(savedRow);

  try {
    await getRedis().del(REDIS_CONFIG_KEY);
  } catch (err) {
    logger.warn({ err }, 'Failed to invalidate redis dictionary config cache');
  }

  return view;
}

const aiEnrichmentOutputSchema = z.object({
  meanings: z.array(
    z.object({
      partOfSpeech: z.string(),
      definitionsZh: z.array(z.string()),
    }),
  ),
  contextSentenceZh: z.string().optional(),
  contextNote: z.string().optional(),
});

async function enrichEntryWithAi(
  entry: DictionaryEntry,
  context?: { sentence?: string; workId?: string; partId?: string; workTitle?: string },
): Promise<DictionaryEntry> {
  try {
    const promptLines: string[] = [
      `You are an expert English-to-Chinese lexicographer and reading companion.`,
      `Provide accurate, natural, and concise Chinese translations for the following dictionary word: "${entry.word}".`,
      ``,
      `English meanings:`,
      JSON.stringify(
        entry.meanings.map((m) => ({
          partOfSpeech: m.partOfSpeech,
          definitions: m.definitions.map((d) => d.definition),
        })),
        null,
        2,
      ),
    ];

    if (context?.sentence?.trim()) {
      promptLines.push(
        ``,
        `Context sentence from the book "${context.workTitle || 'Reading Material'}":`,
        `"${context.sentence.trim()}"`,
        ``,
        `Translate the context sentence into natural Chinese (contextSentenceZh), and provide a brief (1-2 sentences) reading note (contextNote) explaining how "${entry.word}" functions or is nuanced in this context.`,
      );
    }

    const aiResult = await invokeAi({
      purpose: 'assist',
      source: 'dictionary:enrichment',
      messages: [{ role: 'user', content: promptLines.join('\n') }],
      outputSchema: aiEnrichmentOutputSchema,
      timeoutMs: 15000,
    });

    const parsed = aiResult.content;
    const aiMeanings = Array.isArray(parsed?.meanings) ? parsed.meanings : [];
    const enrichedMeanings: DictionaryMeaning[] = entry.meanings.map((meaning) => {
      const matchedAiMeaning = aiMeanings.find(
        (m) => m?.partOfSpeech?.toLowerCase() === meaning.partOfSpeech.toLowerCase(),
      );
      const enrichedDefinitions: DictionaryDefinition[] = meaning.definitions.map((def, idx) => {
        const zh = matchedAiMeaning?.definitionsZh?.[idx];
        return {
          ...def,
          definitionZh: zh || def.definitionZh,
        };
      });
      return {
        ...meaning,
        definitions: enrichedDefinitions,
      };
    });

    const contextExamples: DictionaryContextExample[] = [...(entry.contextExamples || [])];
    if (context?.sentence?.trim()) {
      contextExamples.unshift({
        sentence: context.sentence.trim(),
        sentenceZh: parsed?.contextSentenceZh,
        note: parsed?.contextNote,
        workId: context.workId,
        partId: context.partId,
        workTitle: context.workTitle,
      });
    }

    return {
      ...entry,
      meanings: enrichedMeanings,
      contextExamples: contextExamples.length > 0 ? contextExamples : undefined,
    };
  } catch (error) {
    logger.warn({ err: error, word: entry.word }, 'AI dictionary enrichment failed; proceeding with base entry');
    // Graceful fallback to raw entry without breaking lookup
    if (context?.sentence?.trim()) {
      const contextExamples: DictionaryContextExample[] = [...(entry.contextExamples || [])];
      contextExamples.unshift({
        sentence: context.sentence.trim(),
        workId: context.workId,
        partId: context.partId,
        workTitle: context.workTitle,
      });
      return { ...entry, contextExamples };
    }
    return entry;
  }
}

export type LookupWordOptions = {
  word: string;
  contextSentence?: string;
  workId?: string;
  partId?: string;
  bypassCache?: boolean;
};

export async function lookupWord(options: LookupWordOptions): Promise<DictionaryEntry | null> {
  const cleanWord = options.word.trim().toLowerCase();
  if (!cleanWord) {
    return null;
  }

  const config = await getDictionaryConfig();
  if (!config.isEnabled && !options.bypassCache) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, '词典查询服务已在管理后台禁用');
  }

  const cacheKey = wordCacheKey(cleanWord);
  const cacheTtlSeconds = (config.cacheTtlDays || 30) * 86400;

  // L1: Redis Cache
  if (!options.bypassCache) {
    try {
      const raw = await getRedis().get(cacheKey);
      if (raw) {
        const entry = JSON.parse(raw) as DictionaryEntry;
        return {
          ...entry,
          fromCache: true,
        };
      }
    } catch (err) {
      logger.warn({ err, word: cleanWord }, 'Redis dictionary cache read failed');
    }

    // L2: PostgreSQL DB Cache
    try {
      const [dbEntry] = await db
        .select()
        .from(dictionaryEntryTable)
        .where(eq(dictionaryEntryTable.word, cleanWord))
        .limit(1);

      if (dbEntry) {
        const entry: DictionaryEntry = {
          id: dbEntry.id,
          word: dbEntry.word,
          phonetics: dbEntry.phonetics,
          meanings: dbEntry.meanings,
          contextExamples: dbEntry.contextExamples,
          source: dbEntry.source,
          fromCache: true,
          createdAt: dbEntry.createdAt.toISOString(),
          updatedAt: dbEntry.updatedAt.toISOString(),
        };

        try {
          await getRedis().set(cacheKey, JSON.stringify(entry), 'EX', cacheTtlSeconds);
        } catch (err) {
          logger.warn({ err, word: cleanWord }, 'Redis dictionary cache write failed');
        }

        return entry;
      }
    } catch (err) {
      logger.warn({ err, word: cleanWord }, 'Database dictionary lookup failed');
    }
  }

  // L3: External Provider Lookup
  const provider = getDictionaryProvider(config.provider);
  let apiKeyDecrypted: string | null = null;
  const row = await loadConfigRow();
  if (row?.apiKeyCiphertext) {
    try {
      apiKeyDecrypted = decryptApiKey(row.apiKeyCiphertext);
    } catch {
      apiKeyDecrypted = null;
    }
  }

  let providerResult: RawProviderResult | null = null;
  try {
    providerResult = await provider.lookup(cleanWord, {
      customEndpoint: config.customEndpoint,
      apiKey: apiKeyDecrypted,
      timeoutMs: config.timeoutMs,
    });
  } catch (providerError) {
    const shouldTryFallback =
      config.provider !== DICTIONARY_PROVIDER_YOUDAO && isTransientDictionaryProviderFailure(providerError);

    if (!shouldTryFallback) {
      logger.warn(
        { err: providerError, provider: config.provider, word: cleanWord },
        'Primary dictionary provider failed; not attempting fallback',
      );
      throw providerError;
    }

    logger.warn(
      { err: providerError, provider: config.provider, word: cleanWord },
      'Primary dictionary provider failed; trying fallback provider',
    );
    try {
      providerResult = await youdaoDictionaryProvider.lookup(cleanWord, {
        timeoutMs: config.timeoutMs,
      });
    } catch (fallbackError) {
      logger.error({ err: fallbackError, word: cleanWord }, 'Fallback dictionary provider also failed');
      throw providerError;
    }
  }

  if (!providerResult) {
    return null;
  }

  let finalEntry: DictionaryEntry = providerResult.entry;

  // Resolve work title if workId is present
  let workTitle: string | undefined;
  if (options.workId) {
    try {
      const [work] = await db
        .select({ title: readingWork.title })
        .from(readingWork)
        .where(eq(readingWork.id, options.workId))
        .limit(1);
      workTitle = work?.title;
    } catch {
      workTitle = undefined;
    }
  }

  // L4: AI Enrichment (if enabled)
  if (config.enableAiEnrichment) {
    finalEntry = await enrichEntryWithAi(finalEntry, {
      sentence: options.contextSentence,
      workId: options.workId,
      partId: options.partId,
      workTitle,
    });
  }

  // Persist to L2 (Database)
  const entryId = `dict_${randomUUID()}`;
  try {
    await db
      .insert(dictionaryEntryTable)
      .values({
        id: entryId,
        word: cleanWord,
        phonetics: finalEntry.phonetics,
        meanings: finalEntry.meanings,
        contextExamples: finalEntry.contextExamples || [],
        rawProviderData: providerResult.rawData,
        source: config.provider,
      })
      .onConflictDoUpdate({
        target: dictionaryEntryTable.word,
        set: {
          phonetics: finalEntry.phonetics,
          meanings: finalEntry.meanings,
          contextExamples: finalEntry.contextExamples || [],
          rawProviderData: providerResult.rawData,
          source: config.provider,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    logger.error({ err, word: cleanWord }, 'Failed to persist dictionary entry in DB');
  }

  // Persist to L1 (Redis)
  try {
    await getRedis().set(cacheKey, JSON.stringify(finalEntry), 'EX', cacheTtlSeconds);
  } catch (err) {
    logger.warn({ err, word: cleanWord }, 'Redis dictionary cache write failed');
  }

  return finalEntry;
}

export async function testDictionary(body: TestDictionaryBody): Promise<TestDictionaryResult> {
  const started = Date.now();
  const config = await getDictionaryConfig();

  const entry = await lookupWord({
    word: body.word,
    contextSentence: body.contextSentence,
    workId: body.workId,
    partId: body.partId,
    bypassCache: true,
  });

  if (!entry) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, `未找到单词 "${body.word}" 的词典释义`);
  }

  return {
    ok: true,
    latencyMs: Date.now() - started,
    provider: config.provider,
    entry,
  };
}
