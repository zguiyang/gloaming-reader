import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { apiRequest, ApiRequestError, formatApiError, isUnauthorizedError } from './api-request';
import { LOCALE_COOKIE_NAME } from './client-locale';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const pingSchema = z.object({ ok: z.literal(true) });

describe('apiRequest', () => {
  it('returns parsed JSON on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(apiRequest('/api/ping', { schema: pingSchema })).resolves.toEqual({ ok: true });
  });

  it('sends Accept-Language from default locale when no cookie or browser language', async () => {
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('navigator', { language: '' });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/api/ping', { schema: pingSchema });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('Accept-Language')).toBe('zh-CN');
  });

  it('sends Accept-Language from locale cookie', async () => {
    vi.stubGlobal('document', { cookie: `${LOCALE_COOKIE_NAME}=en-US` });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/api/ping', { schema: pingSchema });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('Accept-Language')).toBe('en-US');
  });

  it('allows explicit Accept-Language header override', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/api/ping', { schema: pingSchema, headers: { 'Accept-Language': 'fr-FR' } });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('Accept-Language')).toBe('fr-FR');
  });

  it('sends JSON body with Content-Type by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/api/ping', { method: 'POST', schema: pingSchema, json: { a: 1 } });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ping',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ a: 1 }),
        credentials: 'same-origin',
      }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('localizes 401 Unauthorized to Chinese', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(apiRequest('/api/shelf', { schema: pingSchema })).rejects.toMatchObject({
      message: '未登录或登录已过期，请重新登录',
      status: 401,
    });
  });

  it('preserves optional error code while keeping message and details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: '标题无效',
            code: 'VALIDATION_FAILED',
            details: [{ path: 'title', message: '太短' }],
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    );

    try {
      await apiRequest('/api/catalog/works/x', { schema: pingSchema });
      expect.unreachable('expected ApiRequestError');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiRequestError);
      expect(error).toMatchObject({
        message: '标题无效',
        status: 400,
        code: 'VALIDATION_FAILED',
        details: [{ path: 'title', message: '太短' }],
      });
    }
  });

  it('throws ApiRequestError with message and details from error JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: '标题无效', details: [{ path: 'title', message: '太短' }] }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    try {
      await apiRequest('/api/catalog/works/x', { schema: pingSchema });
      expect.unreachable('expected ApiRequestError');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiRequestError);
      expect(error).toMatchObject({
        message: '标题无效',
        status: 400,
        details: [{ path: 'title', message: '太短' }],
      });
    }
  });

  it('throws 502 ApiRequestError when response body fails schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ not: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(apiRequest('/api/ping', { schema: pingSchema })).rejects.toMatchObject({
      message: '响应格式无效',
      status: 502,
    });
  });

  it('returns undefined for 204 with z.void()', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(
      apiRequest('/api/admin/llm/providers/x', { method: 'DELETE', schema: z.void() }),
    ).resolves.toBeUndefined();
  });

  it('invokes optional onError before throw', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: '失败' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const onError = vi.fn();

    await expect(apiRequest('/api/ping', { schema: pingSchema, onError })).rejects.toBeInstanceOf(ApiRequestError);
    expect(onError).toHaveBeenCalledWith(expect.any(ApiRequestError));
  });
});

describe('isUnauthorizedError', () => {
  it('matches only HTTP 401 ApiRequestError instances', () => {
    expect(isUnauthorizedError(new ApiRequestError({ message: '未登录', status: 401 }))).toBe(true);
    expect(isUnauthorizedError(new ApiRequestError({ message: 'Forbidden', status: 403 }))).toBe(false);
    expect(isUnauthorizedError(new Error('未登录'))).toBe(false);
  });
});

describe('formatApiError', () => {
  it('joins details when present', () => {
    expect(
      formatApiError(
        new ApiRequestError({
          message: 'Validation failed',
          status: 400,
          details: [
            { path: 'a', message: 'A' },
            { path: 'b', message: 'B' },
          ],
        }),
      ),
    ).toBe('A；B');
  });
});
