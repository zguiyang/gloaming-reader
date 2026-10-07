import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EPUB_UPLOAD_MAX_BYTES } from '@gloaming/shared/works';

import {
  downloadGutenbergEpub,
  GUTENBERG_EPUB_MAX_REDIRECTS,
  GutenbergEpubDownloadError,
} from '@/domains/discovery/materialization/download';

const OFFICIAL = 'https://www.gutenberg.org/ebooks/1342.epub.images';
const CACHE = 'https://www.gutenberg.org/cache/epub/1342/pg1342.epub.images';

/** Minimal in-memory ZIP/EPUB signature followed by filler bytes. */
function epubBytes(length = 128): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  bytes[0] = 0x50;
  bytes[1] = 0x4b;
  bytes[2] = 0x03;
  bytes[3] = 0x04;
  return bytes;
}

function epubResponse(input: { bytes?: Uint8Array<ArrayBuffer>; headers?: Record<string, string> } = {}): Response {
  return new Response(input.bytes ?? epubBytes(), {
    status: 200,
    headers: { 'content-type': 'application/epub+zip', ...input.headers },
  });
}

function redirectResponse(location: string | null, status = 302): Response {
  const headers: Record<string, string> = {};
  if (location !== null) {
    headers.location = location;
  }
  return new Response(null, { status, headers });
}

/**
 * Pull-based stream so cancellation reaches the underlying source. When
 * `close` is false the source never closes on its own, which lets the helper's
 * reader cancellation be observed instead of hitting an already-closed stream.
 */
function streamedResponse(input: { chunks: Uint8Array[]; close?: boolean; onCancel?: () => void }): Response {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < input.chunks.length) {
        controller.enqueue(input.chunks[index]!);
        index += 1;
        return;
      }
      if (input.close ?? true) {
        controller.close();
      }
    },
    cancel() {
      input.onCancel?.();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'application/epub+zip' } });
}

function abortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

/** Rejects like `fetch` does when its AbortSignal fires. */
function stalledFetch(_input: unknown, init?: RequestInit): Promise<Response> {
  const signal = init?.signal;
  if (signal?.aborted) {
    return Promise.reject(abortError());
  }
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(abortError()), { once: true });
  });
}

describe('downloadGutenbergEpub', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('downloads exactly the one official URL it is given and returns bytes plus metadata', async () => {
    const bytes = epubBytes(256);
    fetchMock.mockResolvedValue(
      epubResponse({
        bytes,
        headers: { etag: '"abc"', 'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT' },
      }),
    );

    const result = await downloadGutenbergEpub(OFFICIAL);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(OFFICIAL);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'GET', redirect: 'manual' });
    expect(result.finalUrl).toBe(OFFICIAL);
    expect(result.byteLength).toBe(bytes.length);
    expect(Buffer.compare(result.bytes, bytes)).toBe(0);
    expect(result.contentType).toBe('application/epub+zip');
    expect(result.etag).toBe('"abc"');
    expect(result.lastModified).toBe('Wed, 01 Jan 2025 00:00:00 GMT');
  });

  it('rejects non-official URLs without issuing any request', async () => {
    for (const url of [
      'http://www.gutenberg.org/ebooks/1342.epub.images',
      'https://example.test/1342.epub.images',
      'https://www.gutenberg.org/ebooks/1342.html',
      'not a url',
    ]) {
      await expect(downloadGutenbergEpub(url)).rejects.toMatchObject({ code: 'invalid_url' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('follows bounded official redirects and resolves relative locations', async () => {
    fetchMock
      .mockResolvedValueOnce(redirectResponse('/cache/epub/1342/pg1342.epub.images'))
      .mockResolvedValueOnce(epubResponse());

    const result = await downloadGutenbergEpub(OFFICIAL);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]![0]).toBe(OFFICIAL);
    expect(fetchMock.mock.calls[1]![0]).toBe(CACHE);
    expect(result.finalUrl).toBe(CACHE);
  });

  it('rejects a redirect that leaves official Gutenberg HTTPS EPUB URLs', async () => {
    fetchMock.mockResolvedValueOnce(redirectResponse('https://example.test/1342.epub.images'));

    await expect(downloadGutenbergEpub(OFFICIAL)).rejects.toMatchObject({ code: 'redirect_unsafe' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a redirect that downgrades to plain HTTP', async () => {
    fetchMock.mockResolvedValueOnce(redirectResponse('http://www.gutenberg.org/ebooks/1342.epub.images'));

    await expect(downloadGutenbergEpub(OFFICIAL)).rejects.toMatchObject({ code: 'redirect_unsafe' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a redirect response without a Location header', async () => {
    fetchMock.mockResolvedValueOnce(redirectResponse(null));

    await expect(downloadGutenbergEpub(OFFICIAL)).rejects.toMatchObject({ code: 'redirect_unsafe' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops after the bounded number of redirects', async () => {
    fetchMock.mockImplementation(async () => redirectResponse(CACHE));

    await expect(downloadGutenbergEpub(OFFICIAL)).rejects.toMatchObject({ code: 'redirect_limit' });
    expect(fetchMock).toHaveBeenCalledTimes(GUTENBERG_EPUB_MAX_REDIRECTS + 1);
  });

  it('surfaces non-2xx responses as http_error with the status', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

    const error: unknown = await downloadGutenbergEpub(OFFICIAL).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(GutenbergEpubDownloadError);
    expect((error as GutenbergEpubDownloadError).code).toBe('http_error');
    expect((error as GutenbergEpubDownloadError).message).toContain('404');
  });

  it('aborts a stalled download with a timeout error', async () => {
    fetchMock.mockImplementation((_input: unknown, init?: RequestInit) => stalledFetch(_input, init));

    await expect(downloadGutenbergEpub(OFFICIAL, { timeoutMs: 20 })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('surfaces transport failures as network_error', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(downloadGutenbergEpub(OFFICIAL)).rejects.toMatchObject({ code: 'network_error' });
  });

  it('reports caller cancellation as aborted rather than network_error', async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockImplementation((_input: unknown, init?: RequestInit) => stalledFetch(_input, init));

    await expect(downloadGutenbergEpub(OFFICIAL, { signal: controller.signal })).rejects.toMatchObject({
      code: 'aborted',
    });
  });

  it('rejects an HTML error page served with HTTP 200', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>not found</html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
    );

    await expect(downloadGutenbergEpub(OFFICIAL)).rejects.toMatchObject({ code: 'unexpected_content' });
  });

  it('rejects a 200 response whose body is not a ZIP archive', async () => {
    fetchMock.mockResolvedValue(
      new Response(Buffer.from('this is not an epub'), {
        status: 200,
        headers: { 'content-type': 'application/epub+zip' },
      }),
    );

    await expect(downloadGutenbergEpub(OFFICIAL)).rejects.toMatchObject({ code: 'unexpected_content' });
  });

  it('rejects a payload whose declared length exceeds the cap', async () => {
    fetchMock.mockResolvedValue(
      new Response(epubBytes(4), {
        status: 200,
        headers: { 'content-type': 'application/epub+zip', 'content-length': '9' },
      }),
    );

    await expect(downloadGutenbergEpub(OFFICIAL, { maxBytes: 8 })).rejects.toMatchObject({ code: 'too_large' });
  });

  it('cancels a streamed payload that grows past the cap', async () => {
    let cancelled = false;
    fetchMock.mockResolvedValue(
      streamedResponse({
        chunks: [epubBytes(8), Buffer.alloc(8, 0x01), Buffer.alloc(8, 0x02)],
        close: false,
        onCancel: () => {
          cancelled = true;
        },
      }),
    );

    await expect(downloadGutenbergEpub(OFFICIAL, { maxBytes: 12 })).rejects.toMatchObject({ code: 'too_large' });
    expect(cancelled).toBe(true);
  });

  it('enforces the shared EPUB upload cap by default', async () => {
    fetchMock.mockResolvedValue(
      new Response(epubBytes(4), {
        status: 200,
        headers: {
          'content-type': 'application/epub+zip',
          'content-length': String(EPUB_UPLOAD_MAX_BYTES + 1),
        },
      }),
    );

    await expect(downloadGutenbergEpub(OFFICIAL)).rejects.toMatchObject({ code: 'too_large' });
  });

  it('streams a valid EPUB body across multiple chunks', async () => {
    fetchMock.mockResolvedValue(streamedResponse({ chunks: [epubBytes(4), Buffer.from([0x01, 0x02, 0x03, 0x04])] }));

    const result = await downloadGutenbergEpub(OFFICIAL, { maxBytes: 64 });

    expect(result.byteLength).toBe(8);
    expect(result.bytes[0]).toBe(0x50);
    expect(result.bytes[1]).toBe(0x4b);
  });
});
