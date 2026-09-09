import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DICTIONARY_PROVIDER_FREE, type DictionaryConfigView, type DictionaryEntry } from '@gloaming/shared/dictionary';

const mocks = vi.hoisted(() => {
  const redisStore = new Map<string, string>();
  return {
    redisStore,
    redisGet: vi.fn(async (key: string) => redisStore.get(key) ?? null),
    redisSet: vi.fn(async (key: string, value: string) => {
      redisStore.set(key, value);
      return 'OK';
    }),
    redisDel: vi.fn(async (key: string) => {
      redisStore.delete(key);
      return 1;
    }),
    dbSelectLimit: vi.fn(async () => [] as unknown[]),
    dbInsertValues: vi.fn(),
    dbOnConflictDoUpdate: vi.fn(async () => []),
    invokeAi: vi.fn(),
    providerLookup: vi.fn(),
  };
});

vi.mock('@/lib/redis', () => ({
  getRedis: () => ({
    get: mocks.redisGet,
    set: mocks.redisSet,
    del: mocks.redisDel,
  }),
}));

vi.mock('@/db', () => {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => mocks.dbSelectLimit());
  chain.values = vi.fn((payload: unknown) => {
    mocks.dbInsertValues(payload);
    return chain;
  });
  chain.onConflictDoUpdate = vi.fn((payload: unknown) => {
    mocks.dbOnConflictDoUpdate(payload);
    return Promise.resolve([]);
  });
  return {
    db: {
      select: vi.fn(() => chain),
      insert: vi.fn(() => chain),
    },
  };
});

vi.mock('@/modules/ai/service', () => ({
  invokeAi: mocks.invokeAi,
}));

vi.mock('@/modules/dictionary/providers/free-dictionary', () => ({
  FreeDictionaryProvider: class {
    id = 'free_dictionary';
    lookup = mocks.providerLookup;
  },
}));

vi.mock('@/modules/dictionary/providers/youdao-dictionary', () => ({
  YoudaoDictionaryProvider: class {
    id = 'youdao';
    lookup = vi.fn();
  },
}));

import { lookupWord, toGenericDictionaryEntry } from '@/modules/dictionary/service';

const REDIS_CONFIG_KEY = 'gloaming:dictionary:config:default';

const baseConfig: DictionaryConfigView = {
  configured: true,
  provider: DICTIONARY_PROVIDER_FREE,
  isEnabled: true,
  enableAiEnrichment: true,
  customEndpoint: null,
  apiKeySet: false,
  apiKeyMasked: null,
  timeoutMs: 5000,
  cacheTtlDays: 30,
  updatedAt: null,
};

function providerEntry(word: string): DictionaryEntry {
  return {
    word,
    phonetics: [{ text: '/tɛst/', role: 'us' }],
    meanings: [
      {
        partOfSpeech: 'noun',
        definitions: [{ definition: `A definition of ${word}` }],
      },
    ],
    source: DICTIONARY_PROVIDER_FREE,
  };
}

function wordCacheKey(word: string): string {
  return `gloaming:dictionary:v1:word:${encodeURIComponent(word.trim().toLowerCase())}`;
}

beforeEach(() => {
  mocks.redisStore.clear();
  mocks.redisStore.set(REDIS_CONFIG_KEY, JSON.stringify(baseConfig));
  mocks.redisGet.mockClear();
  mocks.redisSet.mockClear();
  mocks.redisDel.mockClear();
  mocks.dbSelectLimit.mockReset();
  mocks.dbSelectLimit.mockResolvedValue([]);
  mocks.dbInsertValues.mockReset();
  mocks.dbOnConflictDoUpdate.mockReset();
  mocks.invokeAi.mockReset();
  mocks.providerLookup.mockReset();
});

describe('toGenericDictionaryEntry', () => {
  it('strips contextExamples from shared entries', () => {
    const entry = toGenericDictionaryEntry({
      ...providerEntry('alpha'),
      contextExamples: [
        {
          sentence: 'User A secret context',
          note: 'should not persist',
          workId: 'work-a',
        },
      ],
    });
    expect(entry.contextExamples).toBeUndefined();
    expect(entry.word).toBe('alpha');
  });
});

describe('dictionary context isolation', () => {
  it('caches and returns a generic entry without context', async () => {
    const word = 'isolation_plain';
    mocks.providerLookup.mockResolvedValueOnce({
      entry: providerEntry(word),
      rawData: { ok: true },
    });
    mocks.invokeAi.mockResolvedValueOnce({
      content: {
        meanings: [{ partOfSpeech: 'noun', definitionsZh: ['测试释义'] }],
      },
    });

    const first = await lookupWord({ word });
    expect(first?.meanings[0]?.definitions[0]?.definitionZh).toBe('测试释义');
    expect(first?.contextExamples).toBeUndefined();

    const redisRaw = mocks.redisStore.get(wordCacheKey(word));
    expect(redisRaw).toBeTruthy();
    const redisEntry = JSON.parse(redisRaw!) as DictionaryEntry;
    expect(redisEntry.contextExamples).toBeUndefined();
    expect(mocks.dbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        word,
        contextExamples: [],
      }),
    );

    mocks.providerLookup.mockClear();
    mocks.invokeAi.mockClear();
    mocks.dbInsertValues.mockClear();

    const second = await lookupWord({ word });
    expect(second?.fromCache).toBe(true);
    expect(second?.contextExamples).toBeUndefined();
    expect(mocks.providerLookup).not.toHaveBeenCalled();
    expect(mocks.invokeAi).not.toHaveBeenCalled();
  });

  it('generates request-scoped context without writing it to Redis or DB', async () => {
    const word = 'isolation_ctx';
    mocks.providerLookup.mockResolvedValueOnce({
      entry: providerEntry(word),
      rawData: { ok: true },
    });
    mocks.invokeAi.mockResolvedValueOnce({
      content: {
        meanings: [{ partOfSpeech: 'noun', definitionsZh: ['上下文词'] }],
        contextSentenceZh: '用户甲的句子译文',
        contextNote: '仅本次请求可见',
      },
    });

    const result = await lookupWord({
      word,
      contextSentence: 'User A used isolation_ctx in a novel.',
      workId: 'work-a',
      partId: 'part-a',
    });

    expect(result?.contextExamples).toHaveLength(1);
    expect(result?.contextExamples?.[0]?.sentence).toBe('User A used isolation_ctx in a novel.');
    expect(result?.contextExamples?.[0]?.sentenceZh).toBe('用户甲的句子译文');
    expect(result?.contextExamples?.[0]?.workId).toBe('work-a');

    const redisEntry = JSON.parse(mocks.redisStore.get(wordCacheKey(word))!) as DictionaryEntry;
    expect(redisEntry.contextExamples).toBeUndefined();
    expect(mocks.dbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        word,
        contextExamples: [],
        meanings: expect.any(Array),
      }),
    );
    const persistedMeanings = (mocks.dbInsertValues.mock.calls[0]![0] as { meanings: DictionaryEntry['meanings'] })
      .meanings;
    expect(persistedMeanings[0]?.definitions[0]?.definitionZh).toBe('上下文词');
  });

  it('keeps two different contexts request-local for the same cached word', async () => {
    const word = 'isolation_multi';
    mocks.redisStore.set(
      wordCacheKey(word),
      JSON.stringify({
        ...providerEntry(word),
        meanings: [
          {
            partOfSpeech: 'noun',
            definitions: [{ definition: 'shared', definitionZh: '共享释义' }],
          },
        ],
      }),
    );

    mocks.invokeAi
      .mockResolvedValueOnce({
        content: {
          contextSentenceZh: '用户甲译文',
          contextNote: '甲的笔记',
        },
      })
      .mockResolvedValueOnce({
        content: {
          contextSentenceZh: '用户乙译文',
          contextNote: '乙的笔记',
        },
      });

    const userA = await lookupWord({
      word,
      contextSentence: 'Context belonging to user A.',
      workId: 'work-a',
    });
    const userB = await lookupWord({
      word,
      contextSentence: 'Context belonging to user B.',
      workId: 'work-b',
    });

    expect(userA?.contextExamples?.[0]?.sentence).toBe('Context belonging to user A.');
    expect(userA?.contextExamples?.[0]?.note).toBe('甲的笔记');
    expect(userB?.contextExamples?.[0]?.sentence).toBe('Context belonging to user B.');
    expect(userB?.contextExamples?.[0]?.note).toBe('乙的笔记');
    expect(userA?.contextExamples?.[0]?.sentence).not.toBe(userB?.contextExamples?.[0]?.sentence);

    const redisEntry = JSON.parse(mocks.redisStore.get(wordCacheKey(word))!) as DictionaryEntry;
    expect(redisEntry.contextExamples).toBeUndefined();
    expect(mocks.dbInsertValues).not.toHaveBeenCalled();
  });

  it('strips historical contextExamples from Redis and DB before returning', async () => {
    const word = 'isolation_legacy';
    mocks.redisStore.set(
      wordCacheKey(word),
      JSON.stringify({
        ...providerEntry(word),
        contextExamples: [
          {
            sentence: 'Leaked historical context from another user',
            note: 'must not leak',
            workId: 'work-leaked',
          },
        ],
      }),
    );

    const fromRedis = await lookupWord({ word });
    expect(fromRedis?.fromCache).toBe(true);
    expect(fromRedis?.contextExamples).toBeUndefined();

    mocks.redisStore.clear();
    mocks.redisStore.set(REDIS_CONFIG_KEY, JSON.stringify(baseConfig));
    mocks.dbSelectLimit.mockResolvedValueOnce([
      {
        id: 'dict_legacy',
        word,
        phonetics: [],
        meanings: providerEntry(word).meanings,
        contextExamples: [
          {
            sentence: 'Legacy DB context',
            note: 'old',
            workId: 'work-db',
          },
        ],
        source: DICTIONARY_PROVIDER_FREE,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    ]);

    const fromDb = await lookupWord({ word });
    expect(fromDb?.fromCache).toBe(true);
    expect(fromDb?.contextExamples).toBeUndefined();

    const promoted = JSON.parse(mocks.redisStore.get(wordCacheKey(word))!) as DictionaryEntry;
    expect(promoted.contextExamples).toBeUndefined();
  });

  it('does not write context into cache even when bypassCache skips reads', async () => {
    const word = 'isolation_bypass';
    mocks.providerLookup.mockResolvedValueOnce({
      entry: providerEntry(word),
      rawData: { ok: true },
    });
    mocks.invokeAi.mockResolvedValueOnce({
      content: {
        meanings: [{ partOfSpeech: 'noun', definitionsZh: ['旁路'] }],
        contextSentenceZh: '旁路上下文',
        contextNote: '测试旁路',
      },
    });

    const result = await lookupWord({
      word,
      contextSentence: 'Bypass still must not persist context.',
      bypassCache: true,
    });

    expect(result?.contextExamples?.[0]?.sentenceZh).toBe('旁路上下文');
    const redisEntry = JSON.parse(mocks.redisStore.get(wordCacheKey(word))!) as DictionaryEntry;
    expect(redisEntry.contextExamples).toBeUndefined();
    expect(mocks.dbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        word,
        contextExamples: [],
      }),
    );
  });
});
