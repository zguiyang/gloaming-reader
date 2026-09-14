import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DictionaryEntry } from '@gloaming/shared/dictionary';

import { HTTP_STATUS } from '@/constants';
import { ERROR_CODES } from '@/lib/error-codes';
import { dictionaryRoutes } from '@/modules/dictionary/route';
import * as dictionaryService from '@/modules/dictionary/service';

vi.mock('@/modules/dictionary/service', () => ({
  lookupWord: vi.fn(),
  getDictionaryConfig: vi.fn(),
  putDictionaryConfig: vi.fn(),
  testDictionary: vi.fn(),
}));

function createApp() {
  const app = new Hono();
  app.route('/', dictionaryRoutes);
  return app;
}

const sampleEntry: DictionaryEntry = {
  word: 'hello',
  phonetics: [{ text: '/həˈloʊ/' }],
  meanings: [{ partOfSpeech: 'interjection', definitions: [{ definition: 'used as a greeting' }] }],
  fromCache: false,
};

describe('dictionaryRoutes /api/dictionary/lookup', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('returns localized error and stable code when word is not found', async () => {
    vi.mocked(dictionaryService.lookupWord).mockResolvedValue(null);

    const response = await createApp().request('/api/dictionary/lookup?word=missing', {
      headers: { 'Accept-Language': 'en-US' },
    });

    expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
    await expect(response.json()).resolves.toEqual({
      error: 'No dictionary definition found for "missing"',
      code: ERROR_CODES.NOT_FOUND.WORD_DEFINITION,
    });
  });

  it('localizes not-found error for zh-CN', async () => {
    vi.mocked(dictionaryService.lookupWord).mockResolvedValue(null);

    const response = await createApp().request('/api/dictionary/lookup?word=xyz', {
      headers: { 'Accept-Language': 'zh-CN' },
    });

    expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
    await expect(response.json()).resolves.toEqual({
      error: '未找到单词「xyz」的词典释义',
      code: ERROR_CODES.NOT_FOUND.WORD_DEFINITION,
    });
  });

  it('preserves success response shape when entry exists', async () => {
    vi.mocked(dictionaryService.lookupWord).mockResolvedValue(sampleEntry);

    const response = await createApp().request('/api/dictionary/lookup?word=hello');

    expect(response.status).toBe(HTTP_STATUS.OK);
    await expect(response.json()).resolves.toEqual({ ok: true, entry: sampleEntry });
    expect(dictionaryService.lookupWord).toHaveBeenCalledWith({
      word: 'hello',
      contextSentence: undefined,
      workId: undefined,
      partId: undefined,
    });
  });
});
