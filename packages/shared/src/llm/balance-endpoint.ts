export type NormalizeBalanceEndpointResult = { ok: true; value: string } | { ok: false; message: string };

/**
 * Normalize admin balance endpoint input for storage and {@link resolveProviderBalanceUrl}.
 * Relative paths are joined with the provider base URL. A full http(s) URL on the same
 * origin as baseUrl is reduced to its path; a full URL on another origin is kept as-is.
 */
export function normalizeBalanceEndpoint(raw: string, baseUrl: string): NormalizeBalanceEndpointResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, message: '余额端点不能为空' };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    let endpointUrl: URL;
    let base: URL;
    try {
      endpointUrl = new URL(trimmed);
      base = new URL(baseUrl.trim());
    } catch {
      return { ok: false, message: '余额端点 URL 格式不正确' };
    }
    if (endpointUrl.protocol !== 'http:' && endpointUrl.protocol !== 'https:') {
      return { ok: false, message: '余额端点需为 http(s) 地址' };
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
      return { ok: false, message: '余额端点路径不能为空' };
    }
    return { ok: true, value: path };
  }

  if (/^https?:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    return { ok: false, message: '余额端点请只填路径，不要包含协议；将与 Base URL 自动拼接' };
  }

  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) {
    return { ok: false, message: '余额端点请只填路径，不要包含协议；将与 Base URL 自动拼接' };
  }

  const path = trimmed.replace(/^\/+/, '');
  if (!path) {
    return { ok: false, message: '余额端点路径不能为空' };
  }
  if (/[\s<>"']/.test(path)) {
    return { ok: false, message: '余额端点格式不正确' };
  }
  return { ok: true, value: path };
}
