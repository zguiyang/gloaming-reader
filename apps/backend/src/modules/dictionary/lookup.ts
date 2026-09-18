import { eq } from 'drizzle-orm';

import { dictionaryEntry as dictionaryEntryTable } from '@gloaming/db';
import {
  DICTIONARY_PROVIDER_YOUDAO,
  type DictionaryEntry,
  type TestDictionaryBody,
  type TestDictionaryResult,
} from '@gloaming/shared/dictionary';

import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { AppError } from '@/lib/errors/app-error';
import { ERROR_CODES } from '@/lib/errors/codes';
import { decryptApiKey } from '@/lib/llm';
import { rootLogger } from '@/lib/logger';
import { getRedis } from '@/lib/redis';
import { getDictionaryConfig, loadConfigRow } from '@/modules/dictionary/config';
import {
  attachContextForResponse,
  enrichFreshEntryWithAi,
  enrichGenericMeaningsWithAi,
  type LookupContext,
  resolveWorkTitle,
  withStaticRequestContext,
} from '@/modules/dictionary/enrichment';
import { persistGenericDictionaryEntry, toGenericDictionaryEntry } from '@/modules/dictionary/generic-entry';
import { isTransientDictionaryProviderFailure } from '@/modules/dictionary/provider-errors';
import { getDictionaryProvider, youdaoDictionaryProvider } from '@/modules/dictionary/provider-registry';
import type { RawProviderResult } from '@/modules/dictionary/types';

const logger = rootLogger.child({ module: 'DictionaryService' });

function wordCacheKey(word: string): string {
  return `gloaming:dictionary:v1:word:${encodeURIComponent(word.trim().toLowerCase())}`;
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
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.DICTIONARY.QUERY_DISABLED);
  }

  const cacheKey = wordCacheKey(cleanWord);
  const cacheTtlSeconds = (config.cacheTtlDays || 30) * 86400;
  const hasContext = Boolean(options.contextSentence?.trim());

  let cachedGeneric: DictionaryEntry | null = null;

  // L1/L2: shared caches hold generic entries only. Always strip historical contextExamples.
  if (!options.bypassCache) {
    try {
      const raw = await getRedis().get(cacheKey);
      if (raw) {
        const entry = toGenericDictionaryEntry(JSON.parse(raw) as DictionaryEntry);
        cachedGeneric = { ...entry, fromCache: true };
      }
    } catch (err) {
      logger.warn({ err, word: cleanWord }, 'Redis dictionary cache read failed');
    }

    if (!cachedGeneric) {
      try {
        const [dbEntry] = await db
          .select()
          .from(dictionaryEntryTable)
          .where(eq(dictionaryEntryTable.word, cleanWord))
          .limit(1);

        if (dbEntry) {
          const entry = toGenericDictionaryEntry({
            id: dbEntry.id,
            word: dbEntry.word,
            phonetics: dbEntry.phonetics,
            meanings: dbEntry.meanings,
            // Drop any legacy contextExamples before promoting to Redis or returning.
            contextExamples: undefined,
            source: dbEntry.source,
            fromCache: true,
            createdAt: dbEntry.createdAt.toISOString(),
            updatedAt: dbEntry.updatedAt.toISOString(),
          });
          cachedGeneric = entry;

          try {
            await getRedis().set(cacheKey, JSON.stringify(entry), 'EX', cacheTtlSeconds);
          } catch (err) {
            logger.warn({ err, word: cleanWord }, 'Redis dictionary cache write failed');
          }
        }
      } catch (err) {
        logger.warn({ err, word: cleanWord }, 'Database dictionary lookup failed');
      }
    }
  }

  if (cachedGeneric) {
    if (!hasContext) {
      return cachedGeneric;
    }
    // Context is request-scoped: build on top of the shared generic entry without writing back.
    const withContext = await attachContextForResponse(cachedGeneric, options, config);
    return { ...withContext, fromCache: true };
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

  const baseGeneric = toGenericDictionaryEntry(providerResult.entry);
  let genericToPersist = baseGeneric;
  let responseEntry = baseGeneric;

  const workTitle = await resolveWorkTitle(options.workId);
  const lookupContext: LookupContext | undefined = hasContext
    ? {
        sentence: options.contextSentence,
        workId: options.workId,
        partId: options.partId,
        workTitle,
      }
    : undefined;

  // L4: AI Enrichment (if enabled). Context examples stay on the response only.
  if (config.enableAiEnrichment) {
    if (hasContext) {
      const enriched = await enrichFreshEntryWithAi(baseGeneric, lookupContext);
      genericToPersist = enriched.generic;
      responseEntry = enriched.response;
    } else {
      genericToPersist = await enrichGenericMeaningsWithAi(baseGeneric);
      responseEntry = genericToPersist;
    }
  } else if (hasContext && lookupContext) {
    responseEntry = withStaticRequestContext(baseGeneric, lookupContext);
  }

  await persistGenericDictionaryEntry({
    cleanWord,
    genericEntry: genericToPersist,
    providerResult,
    providerId: config.provider,
    cacheKey,
    cacheTtlSeconds,
  });

  return responseEntry;
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
    throw new AppError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND.WORD_DEFINITION, { word: body.word });
  }

  return {
    ok: true,
    latencyMs: Date.now() - started,
    provider: config.provider,
    entry,
  };
}
