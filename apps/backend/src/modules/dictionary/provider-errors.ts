import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { HTTP_STATUS } from '@/constants';
import { ERROR_CODES } from '@/lib/error-codes';
import { AppError } from '@/lib/errors';
import { rootLogger } from '@/lib/logger';

const providerLogger = rootLogger.child({ module: 'DictionaryProvider' });

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
  providerLogger.warn({ status, statusText, providerLabel }, 'Dictionary provider upstream HTTP error');
  return new AppError(mapUpstreamDictionaryHttpStatus(status), ERROR_CODES.DICTIONARY.UPSTREAM_ERROR);
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
    providerLogger.warn(
      { err: error, providerLabel: options.providerLabel, timeoutMs: options.timeoutMs },
      'Dictionary provider request timed out',
    );
    throw new AppError(HTTP_STATUS.GATEWAY_TIMEOUT, ERROR_CODES.DICTIONARY.REQUEST_TIMEOUT);
  }

  if (options.phase === 'transport') {
    if (error instanceof TypeError) {
      providerLogger.warn({ err: error, providerLabel: options.providerLabel }, 'Dictionary provider fetch failed');
      throw new AppError(HTTP_STATUS.BAD_GATEWAY, ERROR_CODES.DICTIONARY.FETCH_FAILED);
    }

    providerLogger.error(
      { err: error, providerLabel: options.providerLabel },
      'Unexpected dictionary provider transport failure',
    );
    throw new AppError(HTTP_STATUS.INTERNAL_ERROR, ERROR_CODES.DICTIONARY.TRANSPORT_FAILURE);
  }

  if (error instanceof SyntaxError) {
    providerLogger.warn({ err: error, providerLabel: options.providerLabel }, 'Dictionary provider invalid JSON');
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.DICTIONARY.INVALID_JSON);
  }

  if (error instanceof TypeError) {
    providerLogger.warn({ err: error, providerLabel: options.providerLabel }, 'Dictionary provider malformed response');
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.DICTIONARY.MALFORMED_RESPONSE);
  }

  providerLogger.error(
    { err: error, providerLabel: options.providerLabel },
    'Unexpected dictionary provider payload failure',
  );
  throw new AppError(HTTP_STATUS.INTERNAL_ERROR, ERROR_CODES.DICTIONARY.PAYLOAD_FAILURE);
}
