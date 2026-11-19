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
  'passphrase',
  'privatekey',
  'signingkey',
  'encryptionkey',
  'credential',
  'credentials',
  'secretaccesskey',
  'accesskeyid',
  'connectionstring',
  'authorization',
  'bearer',
  'ciphertext',
  'apikeyciphertext',
]);

const LOOKS_LIKE_URL = /^(?:[a-z][a-z\d+.-]*:\/\/|\/|\.\.?\/)/i;
const EMBEDDED_USERINFO_URL = /([a-z][a-z\d+.-]*:\/\/)([^\s/?#@]+)@/gi;
const BEARER_IN_TEXT = /\bBearer\s+\S+/gi;
const BASIC_IN_TEXT = /\bBasic\s+[A-Za-z0-9+/=]+/gi;

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

function redactUrlUserinfo(url: URL): void {
  if (url.username || url.password) {
    url.username = url.username ? REDACTED : '';
    url.password = url.password ? REDACTED : '';
  }
}

export function sanitizeLogUrl(value: string): string {
  const isLikelyUrl = LOOKS_LIKE_URL.test(value);
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

  redactUrlUserinfo(url);

  for (const key of Array.from(url.searchParams.keys())) {
    if (isSensitiveField(key) || ['code', 'state', 'key'].includes(key.toLowerCase())) {
      url.searchParams.set(key, REDACTED);
    }
  }

  return isRelative ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}

/** Scrub secrets from free-text log fields (messages, stacks, opaque strings). */
export function sanitizeLogString(value: string): string {
  const trimmed = value.trim();
  let result = LOOKS_LIKE_URL.test(trimmed) ? sanitizeLogUrl(value) : value;
  result = result.replace(EMBEDDED_USERINFO_URL, `$1${REDACTED}@`);
  result = result.replace(BEARER_IN_TEXT, `Bearer ${REDACTED}`);
  result = result.replace(BASIC_IN_TEXT, `Basic ${REDACTED}`);
  return result;
}

type RedisCommandShape = { name?: unknown; args?: unknown };

function sanitizeRedisCommand(command: unknown, seen: WeakSet<object>): unknown {
  if (!command || typeof command !== 'object') {
    return sanitizeValue(command, seen);
  }
  const cmd = command as RedisCommandShape;
  const name = typeof cmd.name === 'string' ? cmd.name.toLowerCase() : '';
  const rawArgs = Array.isArray(cmd.args) ? cmd.args : [];
  const args = rawArgs.map((arg, index) => {
    if (name === 'auth' && index >= 1) {
      return REDACTED;
    }
    if (name === 'hello') {
      const authIndex = rawArgs.findIndex((entry) => String(entry).toUpperCase() === 'AUTH');
      if (authIndex >= 0 && index > authIndex) {
        return REDACTED;
      }
    }
    if (name === 'config' && String(rawArgs[0] ?? '').toLowerCase() === 'set') {
      const option = String(rawArgs[1] ?? '').toLowerCase();
      if (option.includes('pass') && index >= 2) {
        return REDACTED;
      }
    }
    return sanitizeValue(arg, seen);
  });
  return { name: cmd.name, args };
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
  if (typeof value === 'string') return sanitizeLogString(value);
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
      } else if (normalizedKey === 'command') {
        sanitized[key] = sanitizeRedisCommand(entry, seen);
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
    message: sanitizeLogString(error.message),
    stack: error.stack ? sanitizeLogString(error.stack) : undefined,
  };
  for (const [key, value] of Object.entries(error)) {
    if (key === 'name' || key === 'message' || key === 'stack') continue;
    if (isSensitiveField(key)) {
      sanitized[key] = REDACTED;
    } else if (key === 'command') {
      sanitized[key] = sanitizeRedisCommand(value, seen);
    } else {
      sanitized[key] = sanitizeValue(value, seen);
    }
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
