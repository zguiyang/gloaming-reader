import { afterEach, describe, expect, it, vi } from 'vitest';

import { lookupDictionaryWord } from '@/features/reader/dictionary/reader-dictionary-api';
import type * as ApiRequestModule from '@/lib/api-request';
import { ApiRequestError } from '@/lib/api-request';

const apiRequestMock = vi.fn();

vi.mock('@/lib/api-request', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiRequestModule>();
  return {
    ...actual,
    apiRequest: (...args: unknown[]) => apiRequestMock(...args),
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('lookupDictionaryWord', () => {
  it('returns null when the word definition is not found', async () => {
    apiRequestMock.mockRejectedValue(
      new ApiRequestError({
        message: 'No dictionary definition found for "missing"',
        status: 404,
        code: 'api.errors.notFound.wordDefinition',
      }),
    );

    await expect(lookupDictionaryWord({ word: 'missing' })).resolves.toBeNull();
  });

  it('rethrows transport and server failures instead of returning null', async () => {
    const serverError = new ApiRequestError({
      message: 'Internal server error',
      status: 500,
    });
    apiRequestMock.mockRejectedValue(serverError);

    await expect(lookupDictionaryWord({ word: 'hello' })).rejects.toBe(serverError);
  });

  it('returns the entry on success', async () => {
    const entry = {
      word: 'hello',
      phonetics: [],
      meanings: [{ partOfSpeech: 'n.', definitions: [{ definition: 'greeting' }] }],
    };
    apiRequestMock.mockResolvedValue({ ok: true, entry });

    await expect(lookupDictionaryWord({ word: 'hello' })).resolves.toEqual(entry);
  });
});
