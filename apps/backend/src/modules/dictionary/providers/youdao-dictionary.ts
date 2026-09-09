import {
  DICTIONARY_PROVIDER_YOUDAO,
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

const logger = rootLogger.child({ module: 'YoudaoDictionaryProvider' });
const PROVIDER_LABEL = 'Youdao Dictionary API';

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

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertObjectArrayItems(items: unknown[], label: string): void {
  for (const item of items) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError(`${label} items must be objects`);
    }
  }
}

function normalizeYoudaoPayload(raw: unknown, cleanWord: string): RawProviderResult | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Youdao Dictionary response root must be an object');
  }

  const root = raw as Record<string, unknown>;

  let ec: YoudaoJsonApiResponse['ec'] | undefined;
  let simple: YoudaoJsonApiResponse['simple'] | undefined;
  let ee: YoudaoJsonApiResponse['ee'] | undefined;

  if (root.ec !== undefined) {
    assertPlainObject(root.ec, 'Youdao Dictionary ec');
    if (root.ec.word !== undefined) {
      if (!Array.isArray(root.ec.word)) {
        throw new TypeError('Youdao Dictionary ec.word must be an array');
      }
      assertObjectArrayItems(root.ec.word, 'Youdao Dictionary ec.word');
    }
    ec = root.ec as YoudaoJsonApiResponse['ec'];
  }
  if (root.simple !== undefined) {
    assertPlainObject(root.simple, 'Youdao Dictionary simple');
    if (root.simple.word !== undefined) {
      if (!Array.isArray(root.simple.word)) {
        throw new TypeError('Youdao Dictionary simple.word must be an array');
      }
      assertObjectArrayItems(root.simple.word, 'Youdao Dictionary simple.word');
    }
    simple = root.simple as YoudaoJsonApiResponse['simple'];
  }
  if (root.ee !== undefined) {
    assertPlainObject(root.ee, 'Youdao Dictionary ee');
    if (root.ee.word !== undefined) {
      assertPlainObject(root.ee.word, 'Youdao Dictionary ee.word');
    }
    ee = root.ee as YoudaoJsonApiResponse['ee'];
  }

  const ecWord = ec?.word?.[0];
  const simpleWord = simple?.word?.[0];
  const eeWord = ee?.word;

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
  if (ecWord?.trs != null) {
    if (!Array.isArray(ecWord.trs)) {
      throw new TypeError('Youdao Dictionary ec.trs must be an array');
    }
    for (const trGroup of ecWord.trs) {
      if (trGroup === null || typeof trGroup !== 'object') {
        throw new TypeError('Youdao Dictionary ec.trs items must be objects');
      }
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
  if (eeWord?.trs != null) {
    if (!Array.isArray(eeWord.trs)) {
      throw new TypeError('Youdao Dictionary ee.trs must be an array');
    }
    for (const trItem of eeWord.trs) {
      if (trItem === null || typeof trItem !== 'object') {
        throw new TypeError('Youdao Dictionary ee.trs items must be objects');
      }
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
      let response: Response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
            ...(options?.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
          },
        });
      } catch (error) {
        if (!(error instanceof Error && error.name === 'AbortError')) {
          logger.error({ err: error, word: cleanWord }, 'Failed to lookup word from Youdao Dictionary');
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
        return normalizeYoudaoPayload(raw, cleanWord);
      } catch (error) {
        if (!(error instanceof AppError) && !(error instanceof Error && error.name === 'AbortError')) {
          logger.error({ err: error, word: cleanWord }, 'Failed to lookup word from Youdao Dictionary');
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
