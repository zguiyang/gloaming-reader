'use client';

import { useQuery } from '@tanstack/react-query';

import {
  type DictionaryEntry,
  type LookupDictionaryQuery,
  lookupDictionaryResultSchema,
} from '@gloaming/shared/dictionary';

import { apiRequest } from '@/lib/api-request';

export const dictionaryQueryKey = {
  all: ['dictionary'] as const,
  lookup: (word: string, workId?: string, partId?: string) =>
    [...dictionaryQueryKey.all, 'lookup', word.trim().toLowerCase(), workId ?? '', partId ?? ''] as const,
};

export async function lookupDictionaryWord(
  query: LookupDictionaryQuery,
  init?: { signal?: AbortSignal },
): Promise<DictionaryEntry | null> {
  const cleanWord = query.word.trim();
  if (!cleanWord) return null;

  const params = new URLSearchParams({ word: cleanWord });
  if (query.contextSentence?.trim()) {
    params.set('contextSentence', query.contextSentence.trim());
  }
  if (query.workId) {
    params.set('workId', query.workId);
  }
  if (query.partId) {
    params.set('partId', query.partId);
  }

  try {
    const data = await apiRequest(`/api/dictionary/lookup?${params.toString()}`, {
      schema: lookupDictionaryResultSchema,
      signal: init?.signal,
    });
    return data.entry;
  } catch {
    return null;
  }
}

export function useDictionaryLookupQuery(options: {
  word: string | null;
  contextSentence?: string;
  workId?: string;
  partId?: string;
  enabled?: boolean;
}) {
  const cleanWord = options.word?.trim() ?? '';
  return useQuery({
    queryKey: dictionaryQueryKey.lookup(cleanWord, options.workId, options.partId),
    queryFn: ({ signal }) =>
      lookupDictionaryWord(
        {
          word: cleanWord,
          contextSentence: options.contextSentence,
          workId: options.workId,
          partId: options.partId,
        },
        { signal },
      ),
    enabled: Boolean(options.enabled && cleanWord),
    staleTime: 1000 * 60 * 60, // 1 hour client cache
  });
}
