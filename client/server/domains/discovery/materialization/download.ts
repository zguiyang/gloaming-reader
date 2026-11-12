import { EPUB_UPLOAD_MAX_BYTES } from '@gloaming/shared/works';

import { PROJECT_GUTENBERG_USER_AGENT } from '../gutenberg/constants';
import { isOfficialGutenbergEpubUrl } from './epub-candidate';

/**
 * Bounded, single-URL EPUB downloader for the discovery materialization layer.
 *
 * It downloads exactly the one official Project Gutenberg HTTPS EPUB URL it is
 * given: it never searches synced metadata for alternatives, never crawls, and
 * never bulk-downloads. Redirects are followed manually so every hop can be
 * constrained to another official Gutenberg HTTPS EPUB URL. Bytes stay in
 * memory only; the caller receives them plus response metadata and nothing is
 * persisted, linked, or enqueued here.
 */

/** Wall-clock budget for the whole request, including streaming the body. */
export const GUTENBERG_EPUB_DOWNLOAD_TIMEOUT_MS = 30_000;

/** Maximum number of official redirect hops tolerated before failing. */
export const GUTENBERG_EPUB_MAX_REDIRECTS = 5;

const GUTENBERG_EPUB_ACCEPT = 'application/epub+zip, application/octet-stream;q=0.9, */*;q=0.1';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** HTML/text/XHTML responses are error pages, not EPUB archives. */
const HTML_OR_TEXT_MIME_PATTERN = /^(?:text\/|application\/xhtml)/i;

export type GutenbergEpubDownloadErrorCode =
  | 'invalid_url'
  | 'invalid_options'
  | 'redirect_unsafe'
  | 'redirect_limit'
  | 'http_error'
  | 'unexpected_content'
  | 'too_large'
  | 'timeout'
  | 'aborted'
  | 'network_error';

/**
 * Domain-local failure for the bounded EPUB downloader. Messages never include
 * raw response bodies, credentials, or stack traces.
 */
export class GutenbergEpubDownloadError extends Error {
  readonly code: GutenbergEpubDownloadErrorCode;

  constructor(code: GutenbergEpubDownloadErrorCode, message: string) {
    super(message);
    this.name = 'GutenbergEpubDownloadError';
    this.code = code;
  }
}

/** In-memory result of one bounded download; no persistence happens here. */
export type DownloadedGutenbergEpub = {
  readonly bytes: Buffer;
  readonly byteLength: number;
  readonly contentType: string | null;
  readonly finalUrl: string;
  readonly etag: string | null;
  readonly lastModified: string | null;
};

export type DownloadGutenbergEpubOptions = {
  /** Caller cancellation; combined with the internal timeout signal. */
  readonly signal?: AbortSignal;
  /** Overrides {@link GUTENBERG_EPUB_DOWNLOAD_TIMEOUT_MS} (tests / tight budgets). */
  readonly timeoutMs?: number;
  /** Overrides {@link EPUB_UPLOAD_MAX_BYTES} (tests / tighter bounds). */
  readonly maxBytes?: number;
};

/**
 * Downloads exactly one official Project Gutenberg EPUB URL, enforcing the
 * upload size cap while streaming and constraining redirects to official
 * Gutenberg HTTPS EPUB URLs. Throws {@link GutenbergEpubDownloadError} with a
 * stable `code` for every failure mode; never returns partial bytes.
 */
export async function downloadGutenbergEpub(
  url: string,
  options: DownloadGutenbergEpubOptions = {},
): Promise<DownloadedGutenbergEpub> {
  if (!isOfficialGutenbergEpubUrl(url)) {
    throw new GutenbergEpubDownloadError('invalid_url', 'the URL is not an official Project Gutenberg HTTPS EPUB URL');
  }

  const timeoutMs = options.timeoutMs ?? GUTENBERG_EPUB_DOWNLOAD_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new GutenbergEpubDownloadError('invalid_options', 'timeoutMs must be a positive number');
  }

  const maxBytes = options.maxBytes ?? EPUB_UPLOAD_MAX_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new GutenbergEpubDownloadError('invalid_options', 'maxBytes must be a positive integer');
  }

  const timeoutController = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, timeoutMs);

  const signals: AbortSignal[] = [timeoutController.signal];
  if (options.signal) {
    signals.push(options.signal);
  }
  const signal = AbortSignal.any(signals);
  const isTimedOut = () => timedOut;

  const headers: Record<string, string> = {
    Accept: GUTENBERG_EPUB_ACCEPT,
    'User-Agent': PROJECT_GUTENBERG_USER_AGENT,
  };

  try {
    let currentUrl = url;
    let response: Response;

    for (let redirects = 0; ; redirects += 1) {
      response = await requestOnce(currentUrl, headers, signal, isTimedOut);

      if (!REDIRECT_STATUSES.has(response.status)) {
        break;
      }

      const location = response.headers.get('location');
      await cancelBody(response);

      if (redirects >= GUTENBERG_EPUB_MAX_REDIRECTS) {
        throw new GutenbergEpubDownloadError(
          'redirect_limit',
          `the EPUB download exceeded ${GUTENBERG_EPUB_MAX_REDIRECTS} redirects`,
        );
      }
      if (!location) {
        throw new GutenbergEpubDownloadError('redirect_unsafe', 'a redirect response had no Location header');
      }

      const nextUrl = new URL(location, currentUrl).toString();
      if (!isOfficialGutenbergEpubUrl(nextUrl)) {
        throw new GutenbergEpubDownloadError(
          'redirect_unsafe',
          'a redirect left the official Project Gutenberg HTTPS EPUB URLs',
        );
      }
      currentUrl = nextUrl;
    }

    if (!response.ok) {
      const status = response.status;
      await cancelBody(response);
      throw new GutenbergEpubDownloadError('http_error', `the EPUB download failed with HTTP status ${status}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType && HTML_OR_TEXT_MIME_PATTERN.test(contentType.trim())) {
      await cancelBody(response);
      throw new GutenbergEpubDownloadError('unexpected_content', `the EPUB download returned ${contentType.trim()}`);
    }

    const bytes = await readBoundedBody(response, maxBytes, isTimedOut);
    if (!isEpubZipArchive(bytes)) {
      throw new GutenbergEpubDownloadError('unexpected_content', 'the EPUB download was not a ZIP archive');
    }

    return {
      bytes,
      byteLength: bytes.length,
      contentType,
      finalUrl: currentUrl,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function requestOnce(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  isTimedOut: () => boolean,
): Promise<Response> {
  try {
    return await fetch(url, { method: 'GET', headers, redirect: 'manual', signal });
  } catch (error) {
    throw toDownloadError(error, isTimedOut());
  }
}

/** Streams the body while enforcing the byte cap; cancels the reader when exceeded. */
async function readBoundedBody(response: Response, maxBytes: number, isTimedOut: () => boolean): Promise<Buffer> {
  const body = response.body;
  if (!body) {
    throw new GutenbergEpubDownloadError('unexpected_content', 'the EPUB download had no body');
  }

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await cancelBody(response);
    throw tooLargeError(maxBytes);
  }

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  try {
    for (;;) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (error) {
        throw toDownloadError(error, isTimedOut());
      }

      if (result.done) {
        break;
      }
      const value = result.value;
      if (!value || value.byteLength === 0) {
        continue;
      }

      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooLargeError(maxBytes);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, total);
}

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function tooLargeError(maxBytes: number): GutenbergEpubDownloadError {
  return new GutenbergEpubDownloadError('too_large', `the EPUB download exceeded the ${maxBytes}-byte limit`);
}

/** True for a plausible EPUB (ZIP) archive signature: local, empty, or spanned. */
function isEpubZipArchive(bytes: Buffer): boolean {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return false;
  }
  const signature = (bytes[2]! << 8) | bytes[3]!;
  return signature === 0x0304 || signature === 0x0506 || signature === 0x0708;
}

function toDownloadError(error: unknown, timedOut: boolean): GutenbergEpubDownloadError {
  if (error instanceof GutenbergEpubDownloadError) {
    return error;
  }
  if (timedOut) {
    return new GutenbergEpubDownloadError('timeout', 'the EPUB download exceeded its time budget');
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new GutenbergEpubDownloadError('aborted', 'the EPUB download was aborted');
  }
  return new GutenbergEpubDownloadError('network_error', 'the EPUB download could not be completed');
}
