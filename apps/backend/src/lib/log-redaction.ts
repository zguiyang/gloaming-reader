export const REDACTED = '[REDACTED]';

const SENSITIVE_HEADER_NAMES = new Set([
  'cookie',
  'set-cookie',
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
]);

const SENSITIVE_FIELD_NAMES = new Set([
  'password',
  'currentpassword',
  'newpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'sessiontoken',
  'verificationtoken',
  'resettoken',
  'apikey',
  'secret',
  'clientsecret',
]);

function isHeaders(value: unknown): value is Headers {
  return typeof Headers !== 'undefined' && value instanceof Headers;
}

function isRequest(value: unknown): value is Request {
  return typeof Request !== 'undefined' && value instanceof Request;
}

function isResponse(value: unknown): value is Response {
  return typeof Response !== 'undefined' && value instanceof Response;
}

function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADER_NAMES.has(name.toLowerCase());
}

function isSensitiveField(name: string): boolean {
  return SENSITIVE_FIELD_NAMES.has(name.replaceAll('_', '').replaceAll('-', '').toLowerCase());
}

export function sanitizeLogUrl(value: string): string {
  const isLikelyUrl = /^(?:[a-z][a-z\d+.-]*:\/\/|\/|\.\.?\/|\?)/i.test(value);
  if (!isLikelyUrl) {
    return value.replace(/([?&])([^=&#\s]+)=([^&#\s]*)/gi, (match, separator: string, key: string) =>
      isSensitiveField(key) || ['code', 'state', 'key'].includes(key.toLowerCase())
        ? `${separator}${key}=${REDACTED}`
        : match,
    );
  }

  let url: URL;
  let isRelative = false;
  try {
    url = new URL(value);
  } catch {
    try {
      url = new URL(value, 'http://log-redaction.invalid');
      isRelative = true;
    } catch {
      return value;
    }
  }

  for (const key of Array.from(url.searchParams.keys())) {
    if (isSensitiveField(key) || ['code', 'state', 'key'].includes(key.toLowerCase())) {
      url.searchParams.set(key, REDACTED);
    }
  }

  return isRelative ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}

export function sanitizeHeaders(headers: Headers | Record<string, unknown> | undefined): Record<string, unknown> {
  if (!headers) return {};

  const sanitized: Record<string, unknown> = {};
  const entries = isHeaders(headers) ? Array.from(headers.entries()) : Object.entries(headers);
  for (const [name, value] of entries) {
    sanitized[name] = isSensitiveHeader(name) ? REDACTED : value;
  }
  return sanitized;
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return value;
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  try {
    if (isHeaders(value)) return sanitizeHeaders(value);
    if (isRequest(value)) {
      return { method: value.method, url: sanitizeLogUrl(value.url), headers: sanitizeHeaders(value.headers) };
    }
    if (isResponse(value)) {
      return {
        status: value.status,
        url: value.url ? sanitizeLogUrl(value.url) : value.url,
        headers: sanitizeHeaders(value.headers),
      };
    }
    if (value instanceof URL) return sanitizeLogUrl(value.toString());
    if (value instanceof Error) return sanitizeError(value, seen);
    if (Array.isArray(value)) return value.map((entry) => sanitizeValue(entry, seen));

    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase();
      if (isSensitiveHeader(key) || isSensitiveField(key)) {
        sanitized[key] = REDACTED;
      } else if (normalizedKey === 'headers') {
        sanitized[key] = sanitizeHeaders(entry as Headers | Record<string, unknown>);
      } else if (normalizedKey === 'url' || normalizedKey === 'uri' || normalizedKey.endsWith('url')) {
        sanitized[key] = typeof entry === 'string' ? sanitizeLogUrl(entry) : sanitizeValue(entry, seen);
      } else {
        sanitized[key] = sanitizeValue(entry, seen);
      }
    }
    return sanitized;
  } finally {
    seen.delete(value);
  }
}

function sanitizeError(error: Error, seen: WeakSet<object> = new WeakSet()): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {
    type: error.name,
    message: sanitizeLogUrl(error.message),
    stack: error.stack ? sanitizeLogUrl(error.stack) : undefined,
  };
  for (const [key, value] of Object.entries(error)) {
    if (key === 'name' || key === 'message' || key === 'stack') continue;
    sanitized[key] = isSensitiveField(key) ? REDACTED : sanitizeValue(value, seen);
  }
  return sanitized;
}

export function sanitizeLogValue(value: unknown): unknown {
  return sanitizeValue(value, new WeakSet());
}

export function serializeLogError(value: unknown): unknown {
  if (value instanceof Error) return sanitizeError(value);
  return sanitizeLogValue(value);
}
