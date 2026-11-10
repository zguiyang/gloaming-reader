import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DictionaryEntry } from '@gloaming/shared/dictionary';

const mocks = vi.hoisted(() => ({
  invokeAi: vi.fn(),
}));

vi.mock('@/domains/ai', () => ({
  invokeAi: mocks.invokeAi,
}));

import { enrichFreshEntryWithAi, enrichGenericMeaningsWithAi } from '@/domains/dictionary/lookup/enrichment';

function entryWithoutZh(word: string): DictionaryEntry {
  return {
    word,
    phonetics: [],
    meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: `A ${word}` }] }],
    source: 'free_dictionary',
  };
}

function entryWithZh(word: string): DictionaryEntry {
  return {
    word,
    phonetics: [],
    meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: `A ${word}`, definitionZh: '已有中文' }] }],
    source: 'youdao',
  };
}

beforeEach(() => {
  mocks.invokeAi.mockReset();
});

describe('dictionary enrichment JSON path', () => {
  it('skips meaning AI when Chinese glosses already exist', async () => {
    const result = await enrichGenericMeaningsWithAi(entryWithZh('skip'));
    expect(result.meanings[0]?.definitions[0]?.definitionZh).toBe('已有中文');
    expect(mocks.invokeAi).not.toHaveBeenCalled();
  });

  it('retries once when the first JSON fails Zod validation', async () => {
    mocks.invokeAi.mockResolvedValueOnce({ content: '{"oops":true}' }).mockResolvedValueOnce({
      content: JSON.stringify({
        meanings: [{ partOfSpeech: 'noun', definitionsZh: ['重试成功'] }],
      }),
    });

    const result = await enrichGenericMeaningsWithAi(entryWithoutZh('retry'));
    expect(result.meanings[0]?.definitions[0]?.definitionZh).toBe('重试成功');
    expect(mocks.invokeAi).toHaveBeenCalledTimes(2);
    expect(mocks.invokeAi.mock.calls[0]?.[0].source).toBe('dictionary:enrichment');
    expect(mocks.invokeAi.mock.calls[1]?.[0].source).toBe('dictionary:enrichment.retry');
    expect(mocks.invokeAi.mock.calls[0]?.[0].jsonObject).toBe(true);
    expect(mocks.invokeAi.mock.calls[0]?.[0].outputSchema).toBeUndefined();
  });

  it('uses a separate context JSON call and does not require AI meanings when zh exists', async () => {
    mocks.invokeAi.mockResolvedValueOnce({
      content: JSON.stringify({
        contextSentenceZh: '上下文译文',
        contextNote: '用法说明',
      }),
    });

    const { generic, response } = await enrichFreshEntryWithAi(entryWithZh('ctx'), {
      sentence: 'She used ctx carefully.',
      workId: 'work-1',
      workTitle: 'Sample',
    });

    expect(generic.contextExamples).toBeUndefined();
    expect(response.contextExamples?.[0]?.sentenceZh).toBe('上下文译文');
    expect(mocks.invokeAi).toHaveBeenCalledTimes(1);
    expect(mocks.invokeAi.mock.calls[0]?.[0].source).toBe('dictionary:context');
  });
});
