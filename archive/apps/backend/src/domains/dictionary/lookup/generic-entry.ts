import { randomUUID } from 'node:crypto';

import { dictionaryEntry as dictionaryEntryTable } from '@gloaming/db';
import type { DictionaryEntry } from '@gloaming/shared/dictionary';

import type { RawProviderResult } from '@/domains/dictionary/providers/types';
import { getRedis } from '@/infra/cache';
import { db } from '@/infra/db';
import { rootLogger } from '@/infra/logging/logger';

const logger = rootLogger.child({ module: 'DictionaryService' });

/** Shared Redis/DB must never retain request-scoped contextExamples. */
export function toGenericDictionaryEntry(entry: DictionaryEntry): DictionaryEntry {
  const { contextExamples: _ignored, ...rest } = entry;
  return {
    ...rest,
    contextExamples: undefined,
  };
}

export async function persistGenericDictionaryEntry(params: {
  cleanWord: string;
  genericEntry: DictionaryEntry;
  providerResult: RawProviderResult;
  providerId: string;
  cacheKey: string;
  cacheTtlSeconds: number;
}): Promise<void> {
  const persistable = toGenericDictionaryEntry(params.genericEntry);
  const entryId = persistable.id || `dict_${randomUUID()}`;

  try {
    await db
      .insert(dictionaryEntryTable)
      .values({
        id: entryId,
        word: params.cleanWord,
        phonetics: persistable.phonetics,
        meanings: persistable.meanings,
        // Shared DB stores only generic entries — never request contextExamples.
        contextExamples: [],
        rawProviderData: params.providerResult.rawData,
        source: params.providerId,
      })
      .onConflictDoUpdate({
        target: dictionaryEntryTable.word,
        set: {
          phonetics: persistable.phonetics,
          meanings: persistable.meanings,
          contextExamples: [],
          rawProviderData: params.providerResult.rawData,
          source: params.providerId,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    logger.error({ err, word: params.cleanWord }, 'Failed to persist dictionary entry in DB');
  }

  try {
    await getRedis().set(params.cacheKey, JSON.stringify(persistable), 'EX', params.cacheTtlSeconds);
  } catch (err) {
    logger.warn({ err, word: params.cleanWord }, 'Redis dictionary cache write failed');
  }
}
