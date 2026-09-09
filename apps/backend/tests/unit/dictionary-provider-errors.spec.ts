import { afterEach, describe, expect, it, vi } from 'vitest';

import { DICTIONARY_PROVIDER_FREE, DICTIONARY_PROVIDER_YOUDAO } from '@gloaming/shared/dictionary';

import { HTTP_STATUS } from '@/constants';
import { AppError } from '@/lib/errors';
import {
  isTransientDictionaryProviderFailure,
  mapUpstreamDictionaryHttpStatus,
  rethrowClassifiedDictionaryProviderError,
} from '@/modules/dictionary/provider-errors';
import { FreeDictionaryProvider } from '@/modules/dictionary/providers/free-dictionary';
import { YoudaoDictionaryProvider } from '@/modules/dictionary/providers/youdao-dictionary';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('isTransientDictionaryProviderFailure', () => {
  it('returns true for gateway-class AppError status codes', () => {
    expect(isTransientDictionaryProviderFailure(new AppError(HTTP_STATUS.BAD_GATEWAY, '502'))).toBe(true);
    expect(isTransientDictionaryProviderFailure(new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, '503'))).toBe(true);
    expect(isTransientDictionaryProviderFailure(new AppError(HTTP_STATUS.GATEWAY_TIMEOUT, '504'))).toBe(true);
  });

  it('returns false for non-transient AppError and non-AppError', () => {
    expect(isTransientDictionaryProviderFailure(new AppError(HTTP_STATUS.BAD_REQUEST, '400'))).toBe(false);
    expect(isTransientDictionaryProviderFailure(new AppError(HTTP_STATUS.UNAUTHORIZED, '401'))).toBe(false);
    expect(isTransientDictionaryProviderFailure(new AppError(HTTP_STATUS.TOO_MANY_REQUESTS, '429'))).toBe(false);
    expect(isTransientDictionaryProviderFailure(new AppError(HTTP_STATUS.INTERNAL_ERROR, '500'))).toBe(false);
    expect(isTransientDictionaryProviderFailure(new TypeError('fetch failed'))).toBe(false);
    expect(isTransientDictionaryProviderFailure(new Error('plain'))).toBe(false);
    expect(isTransientDictionaryProviderFailure('string')).toBe(false);
    expect(isTransientDictionaryProviderFailure(null)).toBe(false);
  });
});

describe('mapUpstreamDictionaryHttpStatus', () => {
  it('maps upstream statuses without treating 4xx as BAD_GATEWAY', () => {
    expect(mapUpstreamDictionaryHttpStatus(500)).toBe(HTTP_STATUS.BAD_GATEWAY);
    expect(mapUpstreamDictionaryHttpStatus(502)).toBe(HTTP_STATUS.BAD_GATEWAY);
    expect(mapUpstreamDictionaryHttpStatus(400)).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(mapUpstreamDictionaryHttpStatus(401)).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(mapUpstreamDictionaryHttpStatus(403)).toBe(HTTP_STATUS.FORBIDDEN);
    expect(mapUpstreamDictionaryHttpStatus(429)).toBe(HTTP_STATUS.TOO_MANY_REQUESTS);
  });
});

describe('rethrowClassifiedDictionaryProviderError', () => {
  it('preserves AppError', () => {
    const err = new AppError(HTTP_STATUS.FORBIDDEN, 'nope');
    expect(() =>
      rethrowClassifiedDictionaryProviderError(err, {
        timeoutMs: 1000,
        providerLabel: 'Test',
        phase: 'transport',
      }),
    ).toThrow(err);
  });

  it('maps AbortError to GATEWAY_TIMEOUT in either phase', () => {
    for (const phase of ['transport', 'payload'] as const) {
      const abort = new Error('aborted');
      abort.name = 'AbortError';
      try {
        rethrowClassifiedDictionaryProviderError(abort, {
          timeoutMs: 1234,
          providerLabel: 'Test',
          phase,
        });
        expect.unreachable('should throw');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).statusCode).toBe(HTTP_STATUS.GATEWAY_TIMEOUT);
        expect(isTransientDictionaryProviderFailure(error)).toBe(true);
      }
    }
  });

  it('maps SyntaxError to BAD_REQUEST in payload phase', () => {
    try {
      rethrowClassifiedDictionaryProviderError(new SyntaxError('bad json'), {
        timeoutMs: 1000,
        providerLabel: 'Test',
        phase: 'payload',
      });
      expect.unreachable('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(isTransientDictionaryProviderFailure(error)).toBe(false);
    }
  });

  it('maps transport TypeError to BAD_GATEWAY (transient)', () => {
    try {
      rethrowClassifiedDictionaryProviderError(new TypeError('fetch failed'), {
        timeoutMs: 1000,
        providerLabel: 'Test',
        phase: 'transport',
      });
      expect.unreachable('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(HTTP_STATUS.BAD_GATEWAY);
      expect(isTransientDictionaryProviderFailure(error)).toBe(true);
    }
  });

  it('maps payload TypeError to BAD_REQUEST (non-transient)', () => {
    try {
      rethrowClassifiedDictionaryProviderError(new TypeError('meanings.map is not a function'), {
        timeoutMs: 1000,
        providerLabel: 'Test',
        phase: 'payload',
      });
      expect.unreachable('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(isTransientDictionaryProviderFailure(error)).toBe(false);
    }
  });

  it('maps unexpected errors to INTERNAL_ERROR (non-transient)', () => {
    try {
      rethrowClassifiedDictionaryProviderError(new Error('boom'), {
        timeoutMs: 1000,
        providerLabel: 'Test',
        phase: 'payload',
      });
      expect.unreachable('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(HTTP_STATUS.INTERNAL_ERROR);
      expect(isTransientDictionaryProviderFailure(error)).toBe(false);
    }
  });
});

describe('FreeDictionaryProvider error classification', () => {
  const provider = new FreeDictionaryProvider();

  it('returns a Free entry on success without classifying as transient failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              word: 'hello',
              meanings: [
                {
                  partOfSpeech: 'noun',
                  definitions: [{ definition: 'a greeting' }],
                },
              ],
            },
          ]),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    );

    const result = await provider.lookup('hello');
    expect(result).not.toBeNull();
    expect(result?.entry.source).toBe(DICTIONARY_PROVIDER_FREE);
    expect(result?.entry.meanings[0]?.definitions[0]?.definition).toBe('a greeting');
  });

  it('returns null on 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Not Found', { status: 404, statusText: 'Not Found' })),
    );

    await expect(provider.lookup('missingword')).resolves.toBeNull();
  });

  it('throws non-transient BAD_REQUEST on upstream 400', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad', { status: 400, statusText: 'Bad Request' })));

    try {
      await provider.lookup('hello');
      expect.unreachable('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(isTransientDictionaryProviderFailure(error)).toBe(false);
    }
  });

  it('throws transient BAD_GATEWAY on upstream 500', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('err', { status: 500, statusText: 'Internal Server Error' })),
    );

    try {
      await provider.lookup('hello');
      expect.unreachable('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(HTTP_STATUS.BAD_GATEWAY);
      expect(isTransientDictionaryProviderFailure(error)).toBe(true);
    }
  });

  it('throws GATEWAY_TIMEOUT on AbortError', async () => {
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));

    try {
      await provider.lookup('hello', { timeoutMs: 50 });
      expect.unreachable('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(HTTP_STATUS.GATEWAY_TIMEOUT);
      expect(isTransientDictionaryProviderFailure(error)).toBe(true);
    }
  });

  it('throws BAD_REQUEST on invalid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('not-json{', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    try {
      await provider.lookup('hello');
      expect.unreachable('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(isTransientDictionaryProviderFailure(error)).toBe(false);
    }
  });

  it('throws non-transient BAD_REQUEST on malformed JSON payload structure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              word: 'hello',
              meanings: { not: 'an-array' },
            },
          ]),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    );

    try {
      await provider.lookup('hello');
      expect.unreachable('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect((error as AppError).message).toMatch(/malformed response/i);
      expect(isTransientDictionaryProviderFailure(error)).toBe(false);
    }
  });

  it('throws BAD_GATEWAY on network TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    try {
      await provider.lookup('hello');
      expect.unreachable('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(HTTP_STATUS.BAD_GATEWAY);
      expect(isTransientDictionaryProviderFailure(error)).toBe(true);
    }
  });

  it('returns null on empty array payload (normal no-result)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(provider.lookup('hello')).resolves.toBeNull();
  });

  it.each([
    [{ word: 'hello' }, 'object root'],
    [null, 'null root'],
    ['hello', 'string root'],
  ])('throws non-transient BAD_REQUEST on non-array root (%s)', async (payload) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    try {
      await provider.lookup('hello');
      expect.unreachable('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(isTransientDictionaryProviderFailure(error)).toBe(false);
    }
  });

  it('throws non-transient BAD_REQUEST when phonetics is not an array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              word: 'hello',
              phonetics: { text: '/həˈloʊ/' },
              meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'hi' }] }],
            },
          ]),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    );

    try {
      await provider.lookup('hello');
      expect.unreachable('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(isTransientDictionaryProviderFailure(error)).toBe(false);
    }
  });

  it('throws non-transient BAD_REQUEST when definitions is not an array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              word: 'hello',
              meanings: [{ partOfSpeech: 'noun', definitions: { definition: 'hi' } }],
            },
          ]),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    );

    try {
      await provider.lookup('hello');
      expect.unreachable('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(isTransientDictionaryProviderFailure(error)).toBe(false);
    }
  });
});

describe('YoudaoDictionaryProvider error classification', () => {
  const provider = new YoudaoDictionaryProvider();

  it('returns a Youdao entry on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ec: {
              word: [
                {
                  usphone: 'həˈləʊ',
                  trs: [{ tr: [{ l: { i: ['n. a greeting'] } }] }],
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    );

    const result = await provider.lookup('hello');
    expect(result).not.toBeNull();
    expect(result?.entry.source).toBe(DICTIONARY_PROVIDER_YOUDAO);
    expect(result?.entry.meanings[0]?.definitions[0]?.definitionZh).toBe('a greeting');
  });

  it('returns null on 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Not Found', { status: 404, statusText: 'Not Found' })),
    );

    await expect(provider.lookup('missingword')).resolves.toBeNull();
  });

  it('returns null on empty object payload (normal no-result)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(provider.lookup('unknownword')).resolves.toBeNull();
  });

  it('returns null when ec.word is empty and there is no phonetic or trs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ec: { word: [] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(provider.lookup('unknownword')).resolves.toBeNull();
  });

  it('throws non-transient BAD_REQUEST on upstream 400', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad', { status: 400, statusText: 'Bad Request' })));

    try {
      await provider.lookup('hello');
      expect.unreachable('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(isTransientDictionaryProviderFailure(error)).toBe(false);
    }
  });

  it('throws transient BAD_GATEWAY on upstream 500', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('err', { status: 500, statusText: 'Internal Server Error' })),
    );

    try {
      await provider.lookup('hello');
      expect.unreachable('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(HTTP_STATUS.BAD_GATEWAY);
      expect(isTransientDictionaryProviderFailure(error)).toBe(true);
    }
  });

  it('throws GATEWAY_TIMEOUT on AbortError', async () => {
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));

    try {
      await provider.lookup('hello', { timeoutMs: 50 });
      expect.unreachable('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(HTTP_STATUS.GATEWAY_TIMEOUT);
      expect(isTransientDictionaryProviderFailure(error)).toBe(true);
    }
  });

  it('throws BAD_REQUEST on invalid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('not-json{', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    try {
      await provider.lookup('hello');
      expect.unreachable('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(isTransientDictionaryProviderFailure(error)).toBe(false);
    }
  });

  it('throws BAD_GATEWAY on network TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    try {
      await provider.lookup('hello');
      expect.unreachable('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(HTTP_STATUS.BAD_GATEWAY);
      expect(isTransientDictionaryProviderFailure(error)).toBe(true);
    }
  });

  it.each([
    [[], 'array root'],
    [null, 'null root'],
    ['hello', 'string root'],
  ])('throws non-transient BAD_REQUEST on illegal root (%s)', async (payload) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    try {
      await provider.lookup('hello');
      expect.unreachable('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(isTransientDictionaryProviderFailure(error)).toBe(false);
    }
  });

  it('throws non-transient BAD_REQUEST when ec.word is not an array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ec: { word: { usphone: 'x' } } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    try {
      await provider.lookup('hello');
      expect.unreachable('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(isTransientDictionaryProviderFailure(error)).toBe(false);
    }
  });

  it('throws non-transient BAD_REQUEST when ee.word is an array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ee: { word: [{ trs: [] }] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    try {
      await provider.lookup('hello');
      expect.unreachable('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(isTransientDictionaryProviderFailure(error)).toBe(false);
    }
  });

  it('throws non-transient BAD_REQUEST when ec is an array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ec: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    try {
      await provider.lookup('hello');
      expect.unreachable('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(isTransientDictionaryProviderFailure(error)).toBe(false);
    }
  });
});

describe('fallback decision gating', () => {
  it('gates Youdao fallback on primary !== youdao AND transient failure', () => {
    const decide = (primaryProvider: string, error: unknown) =>
      primaryProvider !== DICTIONARY_PROVIDER_YOUDAO && isTransientDictionaryProviderFailure(error);

    expect(decide(DICTIONARY_PROVIDER_FREE, new AppError(HTTP_STATUS.BAD_GATEWAY, '502'))).toBe(true);
    expect(decide(DICTIONARY_PROVIDER_FREE, new AppError(HTTP_STATUS.GATEWAY_TIMEOUT, '504'))).toBe(true);
    expect(decide(DICTIONARY_PROVIDER_FREE, new AppError(HTTP_STATUS.BAD_REQUEST, '400'))).toBe(false);
    expect(decide(DICTIONARY_PROVIDER_FREE, new AppError(HTTP_STATUS.INTERNAL_ERROR, '500'))).toBe(false);
    expect(decide(DICTIONARY_PROVIDER_YOUDAO, new AppError(HTTP_STATUS.BAD_GATEWAY, '502'))).toBe(false);
    expect(decide(DICTIONARY_PROVIDER_YOUDAO, new AppError(HTTP_STATUS.GATEWAY_TIMEOUT, '504'))).toBe(false);
  });

  it('does not gate fallback for malformed payload AppError', () => {
    const malformed = new AppError(
      HTTP_STATUS.BAD_REQUEST,
      'Free Dictionary API returned a malformed response: meanings must be an array',
    );
    const decide = (primaryProvider: string, error: unknown) =>
      primaryProvider !== DICTIONARY_PROVIDER_YOUDAO && isTransientDictionaryProviderFailure(error);

    expect(decide(DICTIONARY_PROVIDER_FREE, malformed)).toBe(false);
  });

  it('primary Free malformed payload is non-transient so Youdao lookup would not be gated on', async () => {
    const free = new FreeDictionaryProvider();
    const youdaoLookup = vi.spyOn(YoudaoDictionaryProvider.prototype, 'lookup');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ not: 'an-array' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    try {
      await free.lookup('hello');
      expect.unreachable('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(isTransientDictionaryProviderFailure(error)).toBe(false);
      // Same decide() used by service: payload 400 must not attempt Youdao.
      const shouldTryFallback =
        DICTIONARY_PROVIDER_FREE !== DICTIONARY_PROVIDER_YOUDAO && isTransientDictionaryProviderFailure(error);
      expect(shouldTryFallback).toBe(false);
      if (!shouldTryFallback) {
        // Service would throw primary without calling youdaoDictionaryProvider.lookup
        expect(youdaoLookup).not.toHaveBeenCalled();
      }
    }
  });
});
