export type BalanceEndpointErrorCode =
  | 'api.errors.llm.balanceEndpointEmpty'
  | 'api.errors.llm.balanceEndpointInvalidUrl'
  | 'api.errors.llm.balanceEndpointNotHttp'
  | 'api.errors.llm.balanceEndpointPathEmpty'
  | 'api.errors.llm.balanceEndpointPathOnly'
  | 'api.errors.llm.balanceEndpointInvalidFormat';

export type NormalizeBalanceEndpointResult =
  { ok: true; value: string } | { ok: false; code: BalanceEndpointErrorCode };

/**
 * Normalize admin balance endpoint input for storage and {@link resolveProviderBalanceUrl}.
 * Relative paths are joined with the provider base URL. A full http(s) URL on the same
 * origin as baseUrl is reduced to its path; a full URL on another origin is kept as-is.
 * Failures return an i18n message code, not display text.
 */
export function normalizeBalanceEndpoint(raw: string, baseUrl: string): NormalizeBalanceEndpointResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, code: 'api.errors.llm.balanceEndpointEmpty' };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    let endpointUrl: URL;
    let base: URL;
    try {
      endpointUrl = new URL(trimmed);
      base = new URL(baseUrl.trim());
    } catch {
      return { ok: false, code: 'api.errors.llm.balanceEndpointInvalidUrl' };
    }
    if (endpointUrl.protocol !== 'http:' && endpointUrl.protocol !== 'https:') {
      return { ok: false, code: 'api.errors.llm.balanceEndpointNotHttp' };
    }
    if (endpointUrl.origin !== base.origin) {
      return { ok: true, value: trimmed };
    }
    const basePath = base.pathname.replace(/\/+$/, '');
    let pathPart = `${endpointUrl.pathname}${endpointUrl.search}${endpointUrl.hash}`;
    if (basePath && basePath !== '/' && pathPart.startsWith(basePath)) {
      pathPart = pathPart.slice(basePath.length);
    }
    const path = pathPart.replace(/^\/+/, '');
    if (!path) {
      return { ok: false, code: 'api.errors.llm.balanceEndpointPathEmpty' };
    }
    return { ok: true, value: path };
  }

  if (/^https?:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    return { ok: false, code: 'api.errors.llm.balanceEndpointPathOnly' };
  }

  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) {
    return { ok: false, code: 'api.errors.llm.balanceEndpointPathOnly' };
  }

  const path = trimmed.replace(/^\/+/, '');
  if (!path) {
    return { ok: false, code: 'api.errors.llm.balanceEndpointPathEmpty' };
  }
  if (/[\s<>"']/.test(path)) {
    return { ok: false, code: 'api.errors.llm.balanceEndpointInvalidFormat' };
  }
  return { ok: true, value: path };
}
