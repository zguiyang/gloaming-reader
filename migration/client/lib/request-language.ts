import { getClientLocale } from './client-locale';

/** Merge fetch headers with the active UI locale when Accept-Language is absent. */
export function applyRequestLocale(initHeaders?: HeadersInit): Headers {
  const headers = new Headers(initHeaders);
  if (!headers.has('Accept-Language')) {
    headers.set('Accept-Language', getClientLocale());
  }
  return headers;
}
