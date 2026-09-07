import {
  DICTIONARY_PROVIDER_FREE,
  type DictionaryDefinition,
  type DictionaryMeaning,
  type DictionaryPhonetic,
} from '@gloaming/shared/dictionary';

import { HTTP_STATUS } from '@/constants';
import { AppError } from '@/lib/errors';
import { rootLogger } from '@/lib/logger';
import type { DictionaryProvider, ProviderLookupOptions, RawProviderResult } from '@/modules/dictionary/types';

const logger = rootLogger.child({ module: 'FreeDictionaryProvider' });

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
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(options?.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
        },
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new AppError(
          HTTP_STATUS.BAD_GATEWAY,
          `Free Dictionary API returned status ${response.status}: ${response.statusText}`,
        );
      }

      const raw = (await response.json()) as FreeDictEntry[];
      if (!Array.isArray(raw) || raw.length === 0) {
        return null;
      }

      const first = raw[0];
      const phonetics: DictionaryPhonetic[] = [];

      // If top-level phonetic text exists, add as fallback general phonetic
      if (first.phonetic && (!first.phonetics || first.phonetics.length === 0)) {
        phonetics.push({
          text: first.phonetic,
          role: 'general',
        });
      }

      if (first.phonetics && Array.isArray(first.phonetics)) {
        for (const p of first.phonetics) {
          if (!p.text && !p.audio) continue;
          phonetics.push({
            text: p.text || first.phonetic,
            audio: normalizeAudioUrl(p.audio),
            sourceUrl: p.sourceUrl,
            role: inferPhoneticRole(p),
          });
        }
      }

      const meanings: DictionaryMeaning[] = (first.meanings || []).map((m) => ({
        partOfSpeech: m.partOfSpeech || 'unknown',
        definitions: (m.definitions || []).map((d): DictionaryDefinition => ({
          definition: d.definition,
          example: d.example,
          synonyms: d.synonyms?.length ? d.synonyms : undefined,
          antonyms: d.antonyms?.length ? d.antonyms : undefined,
        })),
        synonyms: m.synonyms?.length ? m.synonyms : undefined,
        antonyms: m.antonyms?.length ? m.antonyms : undefined,
      }));

      return {
        entry: {
          word: first.word || cleanWord,
          phonetics,
          meanings,
          source: DICTIONARY_PROVIDER_FREE,
          fromCache: false,
        },
        rawData: raw,
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AppError(HTTP_STATUS.GATEWAY_TIMEOUT, `Dictionary request timed out after ${timeoutMs}ms`);
      }
      logger.error({ err: error, word: cleanWord }, 'Failed to lookup word from Free Dictionary');
      throw new AppError(
        HTTP_STATUS.BAD_GATEWAY,
        `Failed to fetch from Dictionary Provider: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
