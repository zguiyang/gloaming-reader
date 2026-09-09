import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { HTTP_STATUS } from '@/constants';
import { AppError } from '@/lib/errors';

const TRANSIENT_STATUS_CODES = new Set<number>([
  HTTP_STATUS.BAD_GATEWAY,
  HTTP_STATUS.SERVICE_UNAVAILABLE,
  HTTP_STATUS.GATEWAY_TIMEOUT,
]);

/** Caller-declared stage: only transport TypeErrors are transient. */
export type DictionaryProviderErrorPhase = 'transport' | 'payload';

/**
 * True only for AppError with gateway-class status (502/503/504).
 * Non-AppError values are treated as non-transient (safe: no fallback).
 */
export function isTransientDictionaryProviderFailure(error: unknown): boolean {
  if (!(error instanceof AppError)) {
    return false;
  }
  return TRANSIENT_STATUS_CODES.has(error.statusCode);
}

/** Map an upstream HTTP status to a client-facing AppError status (404 handled by callers). */
export function mapUpstreamDictionaryHttpStatus(status: number): ContentfulStatusCode {
  if (status >= 500) {
    return HTTP_STATUS.BAD_GATEWAY;
  }
  if (status === HTTP_STATUS.UNAUTHORIZED) {
    return HTTP_STATUS.UNAUTHORIZED;
  }
  if (status === HTTP_STATUS.FORBIDDEN) {
    return HTTP_STATUS.FORBIDDEN;
  }
  if (status === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return HTTP_STATUS.TOO_MANY_REQUESTS;
  }
  return HTTP_STATUS.BAD_REQUEST;
}

export function appErrorFromUpstreamDictionaryStatus(
  status: number,
  statusText: string,
  providerLabel: string,
): AppError {
  return new AppError(
    mapUpstreamDictionaryHttpStatus(status),
    `${providerLabel} returned status ${status}: ${statusText}`,
  );
}

/**
 * Reclassify non-AppError failures from provider fetch/parse paths.
 * Phase is declared by the caller — never inferred from error.message.
 */
export function rethrowClassifiedDictionaryProviderError(
  error: unknown,
  options: {
    timeoutMs: number;
    providerLabel: string;
    phase: DictionaryProviderErrorPhase;
  },
): never {
  if (error instanceof AppError) {
    throw error;
  }

  if (error instanceof Error && error.name === 'AbortError') {
    throw new AppError(
      HTTP_STATUS.GATEWAY_TIMEOUT,
      `${options.providerLabel} request timed out after ${options.timeoutMs}ms`,
    );
  }

  if (options.phase === 'transport') {
    if (error instanceof TypeError) {
      throw new AppError(HTTP_STATUS.BAD_GATEWAY, `Failed to fetch from ${options.providerLabel}: ${error.message}`);
    }

    throw new AppError(
      HTTP_STATUS.INTERNAL_ERROR,
      `Unexpected ${options.providerLabel} transport failure: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (error instanceof SyntaxError) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, `${options.providerLabel} returned invalid JSON: ${error.message}`);
  }

  if (error instanceof TypeError) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      `${options.providerLabel} returned a malformed response: ${error.message}`,
    );
  }

  throw new AppError(
    HTTP_STATUS.INTERNAL_ERROR,
    `Unexpected ${options.providerLabel} payload failure: ${error instanceof Error ? error.message : String(error)}`,
  );
}
