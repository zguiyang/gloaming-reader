import {
  DICTIONARY_PROVIDER_YOUDAO,
  type DictionaryDefinition,
  type DictionaryMeaning,
  type DictionaryPhonetic,
} from '@gloaming/shared/dictionary';

import { HTTP_STATUS } from '@/constants';
import { AppError } from '@/lib/errors';
import { rootLogger } from '@/lib/logger';
import type { DictionaryProvider, ProviderLookupOptions, RawProviderResult } from '@/modules/dictionary/types';

const logger = rootLogger.child({ module: 'YoudaoDictionaryProvider' });

const DEFAULT_API_BASE = 'https://dict.youdao.com/jsonapi';

type YoudaoJsonApiResponse = {
  simple?: {
    word?: Array<{
      usphone?: string;
      ukphone?: string;
      usspeech?: string;
      ukspeech?: string;
    }>;
  };
  ec?: {
    word?: Array<{
      usphone?: string;
      ukphone?: string;
      usspeech?: string;
      ukspeech?: string;
      trs?: Array<{
        tr?: Array<{
          l?: {
            i?: string[];
          };
        }>;
      }>;
    }>;
  };
  ee?: {
    word?: {
      trs?: Array<{
        pos?: string;
        tr?: Array<{
          l?: {
            i?: string;
          };
        }>;
      }>;
    };
  };
};

function parsePosAndDefinition(raw: string): { partOfSpeech: string; definitionZh: string } {
  const trimmed = raw.trim();
  const match = trimmed.match(/^([a-zA-Z]+\.|【[^】]+】)\s*(.+)$/);
  if (match && match[1] && match[2]) {
    return {
      partOfSpeech: match[1].replace(/[【】]/g, '').trim(),
      definitionZh: match[2].trim(),
    };
  }
  return {
    partOfSpeech: 'general',
    definitionZh: trimmed,
  };
}

export class YoudaoDictionaryProvider implements DictionaryProvider {
  public readonly id = DICTIONARY_PROVIDER_YOUDAO;

  public async lookup(word: string, options?: ProviderLookupOptions): Promise<RawProviderResult | null> {
    const cleanWord = word.trim().toLowerCase();
    if (!cleanWord) {
      return null;
    }

    const base = (options?.customEndpoint?.trim() || DEFAULT_API_BASE).replace(/\/+$/, '');
    const url = `${base}?q=${encodeURIComponent(cleanWord)}`;
    const timeoutMs = options?.timeoutMs ?? 5000;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
          ...(options?.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
        },
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new AppError(
          HTTP_STATUS.BAD_GATEWAY,
          `Youdao Dictionary API returned status ${response.status}: ${response.statusText}`,
        );
      }

      const raw = (await response.json()) as YoudaoJsonApiResponse;
      const ecWord = raw.ec?.word?.[0];
      const simpleWord = raw.simple?.word?.[0];
      const eeWord = raw.ee?.word;

      const usPhone = ecWord?.usphone || simpleWord?.usphone;
      const ukPhone = ecWord?.ukphone || simpleWord?.ukphone;

      const phonetics: DictionaryPhonetic[] = [];
      if (usPhone || cleanWord) {
        phonetics.push({
          text: usPhone ? `/${usPhone}/` : undefined,
          audio: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(cleanWord)}&type=2`,
          role: 'us',
        });
      }
      if (ukPhone || cleanWord) {
        phonetics.push({
          text: ukPhone ? `/${ukPhone}/` : undefined,
          audio: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(cleanWord)}&type=1`,
          role: 'uk',
        });
      }

      const meaningMap = new Map<string, DictionaryDefinition[]>();

      // 1. Process EC (English -> Chinese) translations
      if (ecWord?.trs && Array.isArray(ecWord.trs)) {
        for (const trGroup of ecWord.trs) {
          const items = trGroup.tr?.[0]?.l?.i;
          if (!items || !Array.isArray(items)) continue;
          for (const item of items) {
            if (!item || typeof item !== 'string') continue;
            const { partOfSpeech, definitionZh } = parsePosAndDefinition(item);
            const list = meaningMap.get(partOfSpeech) || [];
            list.push({
              definition: definitionZh,
              definitionZh,
            });
            meaningMap.set(partOfSpeech, list);
          }
        }
      }

      // 2. Process EE (English -> English) translations if available
      if (eeWord?.trs && Array.isArray(eeWord.trs)) {
        for (const trItem of eeWord.trs) {
          const pos = (trItem.pos || 'general').replace(/\.$/, '').trim();
          const defText = trItem.tr?.[0]?.l?.i;
          if (!defText || typeof defText !== 'string') continue;

          const list = meaningMap.get(pos) || [];
          const existing = list.find((d) => d.definition === defText);
          if (existing) {
            existing.definition = defText;
          } else if (list.length > 0 && !list[0].definition) {
            list[0].definition = defText;
          } else {
            list.push({
              definition: defText,
            });
          }
          meaningMap.set(pos, list);
        }
      }

      if (meaningMap.size === 0 && !usPhone && !ukPhone) {
        return null;
      }

      const meanings: DictionaryMeaning[] = Array.from(meaningMap.entries()).map(([partOfSpeech, definitions]) => ({
        partOfSpeech,
        definitions,
      }));

      return {
        entry: {
          word: cleanWord,
          phonetics,
          meanings:
            meanings.length > 0
              ? meanings
              : [
                  {
                    partOfSpeech: 'general',
                    definitions: [{ definition: cleanWord }],
                  },
                ],
          source: DICTIONARY_PROVIDER_YOUDAO,
          fromCache: false,
        },
        rawData: raw,
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AppError(HTTP_STATUS.GATEWAY_TIMEOUT, `Youdao Dictionary request timed out after ${timeoutMs}ms`);
      }
      logger.error({ err: error, word: cleanWord }, 'Failed to lookup word from Youdao Dictionary');
      throw new AppError(
        HTTP_STATUS.BAD_GATEWAY,
        `Failed to fetch from Youdao Dictionary: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
