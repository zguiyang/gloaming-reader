import { afterEach, describe, expect, it, vi } from 'vitest';

import { ASSIST_SSE_EVENT } from '@gloaming/shared/assist';

import { streamAssistAsk } from '@/features/reader/assist/reader-assist-api';
import { LOCALE_COOKIE_NAME } from '@/lib/client-locale';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('streamAssistAsk', () => {
  it('sends Accept-Language from locale cookie', async () => {
    vi.stubGlobal('document', { cookie: `${LOCALE_COOKIE_NAME}=en-US` });

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`event: ${ASSIST_SSE_EVENT.done}\ndata: {"reply":"hello"}\n\n`));
        controller.close();
      },
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await streamAssistAsk({
      workId: 'work-1',
      partId: 'part-1',
      actionId: 'explain',
      selection: 'hello',
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('Accept-Language')).toBe('en-US');
    expect(new Headers(init.headers).get('Accept')).toBe('text/event-stream');
  });

  it('throws a localized error when the response body is missing', async () => {
    vi.stubGlobal('document', { cookie: `${LOCALE_COOKIE_NAME}=zh-CN` });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      streamAssistAsk({
        workId: 'work-1',
        partId: 'part-1',
        actionId: 'explain',
        selection: 'hello',
      }),
    ).rejects.toThrow('响应为空。');
  });
});
