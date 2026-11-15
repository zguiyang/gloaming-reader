import { assertSafeOutboundUrl } from '@/server/infra/llm/outbound-url';
import { HTTP_STATUS } from '@/server/shared/constants';
import { AppError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

/**
 * Wrap an outbound fetch so the destination is re-checked at request time and
 * redirects are never followed blindly.
 *
 * `assertSafeOutboundUrl` runs when a provider or endpoint is saved, but the
 * response to that request could still be a 3xx pointing at a private address.
 * Redirects are refused rather than replayed: the request body may be a
 * one-shot stream, and a 301/302 would also change the method.
 */
export function createSafeOutboundFetch(inner?: typeof fetch): typeof fetch {
  const baseFetch = inner ?? fetch;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    assertSafeOutboundUrl(requestUrl(input), 'URL');
    const response = await baseFetch(input as RequestInfo, { ...init, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new AppError(HTTP_STATUS.BAD_GATEWAY, ERROR_CODES.OUTBOUND_URL.REDIRECT);
    }
    return response;
  }) as typeof fetch;
}
