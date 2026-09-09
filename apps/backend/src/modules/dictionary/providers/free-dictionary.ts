import {
  DICTIONARY_PROVIDER_FREE,
  type DictionaryDefinition,
  type DictionaryMeaning,
  type DictionaryPhonetic,
} from '@gloaming/shared/dictionary';

import { AppError } from '@/lib/errors';
import { rootLogger } from '@/lib/logger';
import {
  appErrorFromUpstreamDictionaryStatus,
  rethrowClassifiedDictionaryProviderError,
} from '@/modules/dictionary/provider-errors';
import type { DictionaryProvider, ProviderLookupOptions, RawProviderResult } from '@/modules/dictionary/types';

const logger = rootLogger.child({ module: 'FreeDictionaryProvider' });
const PROVIDER_LABEL = 'Free Dictionary API';

const DEFAULT_API_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en';

type FreeDictPhonetic = {
  text?: string;
  audio?: string;
  sourceUrl?: string;
  license?: { name: string; url: string };
};

type FreeDictDefinition = {
  definition: string;
  synonyms?: string[];
  antonyms?: string[];
  example?: string;
};

type FreeDictMeaning = {
  partOfSpeech: string;
  definitions: FreeDictDefinition[];
  synonyms?: string[];
  antonyms?: string[];
};

type FreeDictEntry = {
  word: string;
  phonetic?: string;
  phonetics?: FreeDictPhonetic[];
  meanings?: FreeDictMeaning[];
  license?: { name: string; url: string };
  sourceUrls?: string[];
};

function normalizeAudioUrl(rawUrl?: string): string | undefined {
  if (!rawUrl || !rawUrl.trim()) return undefined;
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith('//')) {
    return `https:${trimmed}`;
  }
  return trimmed;
}

function inferPhoneticRole(phonetic: FreeDictPhonetic): 'us' | 'uk' | 'general' {
  const audio = (phonetic.audio || '').toLowerCase();
  if (audio.includes('-us.mp3') || audio.includes('/us/') || audio.includes('en-us')) {
    return 'us';
  }
  if (audio.includes('-uk.mp3') || audio.includes('-gb.mp3') || audio.includes('/uk/') || audio.includes('en-uk')) {
    return 'uk';
  }
  return 'general';
}

function normalizeFreeDictionaryPayload(raw: unknown, cleanWord: string): RawProviderResult | null {
  if (!Array.isArray(raw)) {
    throw new TypeError('Free Dictionary response root must be an array');
  }
  if (raw.length === 0) {
    return null;
  }

  const first = raw[0];
  if (first === null || typeof first !== 'object' || Array.isArray(first)) {
    throw new TypeError('Free Dictionary entry root must be an object');
  }

  const entry = first as FreeDictEntry;
  const phonetics: DictionaryPhonetic[] = [];

  // If top-level phonetic text exists, add as fallback general phonetic
  if (entry.phonetic && (!entry.phonetics || entry.phonetics.length === 0)) {
    phonetics.push({
      text: entry.phonetic,
      role: 'general',
    });
  }

  if (entry.phonetics != null) {
    if (!Array.isArray(entry.phonetics)) {
      throw new TypeError('Free Dictionary phonetics must be an array');
    }
    for (const p of entry.phonetics) {
      if (p === null || typeof p !== 'object') {
        throw new TypeError('Free Dictionary phonetic items must be objects');
      }
      if (!p.text && !p.audio) continue;
      phonetics.push({
        text: p.text || entry.phonetic,
        audio: normalizeAudioUrl(p.audio),
        sourceUrl: p.sourceUrl,
        role: inferPhoneticRole(p),
      });
    }
  }

  if (entry.meanings != null && !Array.isArray(entry.meanings)) {
    throw new TypeError('Free Dictionary meanings must be an array');
  }

  const meanings: DictionaryMeaning[] = (entry.meanings || []).map((m) => {
    if (m === null || typeof m !== 'object') {
      throw new TypeError('Free Dictionary meaning items must be objects');
    }
    if (m.definitions != null && !Array.isArray(m.definitions)) {
      throw new TypeError('Free Dictionary definitions must be an array');
    }
    return {
      partOfSpeech: m.partOfSpeech || 'unknown',
      definitions: (m.definitions || []).map((d): DictionaryDefinition => {
        if (d === null || typeof d !== 'object') {
          throw new TypeError('Free Dictionary definition items must be objects');
        }
        return {
          definition: d.definition,
          example: d.example,
          synonyms: d.synonyms?.length ? d.synonyms : undefined,
          antonyms: d.antonyms?.length ? d.antonyms : undefined,
        };
      }),
      synonyms: m.synonyms?.length ? m.synonyms : undefined,
      antonyms: m.antonyms?.length ? m.antonyms : undefined,
    };
  });

  return {
    entry: {
      word: entry.word || cleanWord,
      phonetics,
      meanings,
      source: DICTIONARY_PROVIDER_FREE,
      fromCache: false,
    },
    rawData: raw,
  };
}

export class FreeDictionaryProvider implements DictionaryProvider {
  public readonly id = DICTIONARY_PROVIDER_FREE;

  public async lookup(word: string, options?: ProviderLookupOptions): Promise<RawProviderResult | null> {
    const cleanWord = word.trim().toLowerCase();
    if (!cleanWord) {
      return null;
    }

    const base = (options?.customEndpoint?.trim() || DEFAULT_API_BASE).replace(/\/+$/, '');
    const url = `${base}/${encodeURIComponent(cleanWord)}`;
    const timeoutMs = options?.timeoutMs ?? 5000;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let response: Response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            ...(options?.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
          },
        });
      } catch (error) {
        if (!(error instanceof Error && error.name === 'AbortError')) {
          logger.error({ err: error, word: cleanWord }, 'Failed to lookup word from Free Dictionary');
        }
        rethrowClassifiedDictionaryProviderError(error, {
          timeoutMs,
          providerLabel: PROVIDER_LABEL,
          phase: 'transport',
        });
      }

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw appErrorFromUpstreamDictionaryStatus(response.status, response.statusText, PROVIDER_LABEL);
      }

      try {
        const raw: unknown = await response.json();
        return normalizeFreeDictionaryPayload(raw, cleanWord);
      } catch (error) {
        if (!(error instanceof AppError) && !(error instanceof Error && error.name === 'AbortError')) {
          logger.error({ err: error, word: cleanWord }, 'Failed to lookup word from Free Dictionary');
        }
        rethrowClassifiedDictionaryProviderError(error, {
          timeoutMs,
          providerLabel: PROVIDER_LABEL,
          phase: 'payload',
        });
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
