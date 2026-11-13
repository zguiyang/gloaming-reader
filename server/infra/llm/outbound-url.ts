import { HTTP_STATUS } from '@/server/shared/constants';
import { AppError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal', 'metadata.goog']);

function isPrivateIpv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) {
    return false;
  }
  const octets = match.slice(1, 5).map((part) => Number(part));
  if (octets.some((value) => value > 255)) {
    return false;
  }
  const [a, b] = octets;
  if (a === 10) {
    return true;
  }
  if (a === 127) {
    return true;
  }
  if (a === 0) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  return false;
}

/**
 * Public unicast IPv6 lives in `2000::/3`. Loopback (`::1`), unspecified (`::`),
 * link/site-local (`fe80::`/`fec0::`), ULA (`fc00::`/`fd00::`), multicast
 * (`ff00::`) and IPv4-mapped forms (`::ffff:7f00:1`) all fall outside it, so a
 * single range test replaces the individual prefix checks that previously missed
 * bracketed literals and IPv4-mapped addresses.
 */
function isPublicIpv6(host: string): boolean {
  const firstHextet = /^([0-9a-f]{1,4}):/i.exec(host)?.[1];
  if (firstHextet === undefined) {
    return false;
  }
  return (Number.parseInt(firstHextet, 16) & 0xe000) === 0x2000;
}

function isBlockedHost(hostname: string): boolean {
  // WHATWG `URL.hostname` keeps the brackets around IPv6 literals
  // (`http://[::1]` → `[::1]`), so strip them before matching below.
  const normalized = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (!normalized) {
    return true;
  }
  if (BLOCKED_HOSTNAMES.has(normalized)) {
    return true;
  }
  if (normalized.endsWith('.localhost')) {
    return true;
  }
  // An IPv4 address can still be spelled as an IPv4-mapped IPv6 suffix.
  const dottedSuffix = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(normalized)?.[1];
  if (dottedSuffix && isPrivateIpv4(dottedSuffix)) {
    return true;
  }
  if (normalized.includes(':')) {
    return !isPublicIpv6(normalized);
  }
  return isPrivateIpv4(normalized);
}

/**
 * Reject outbound URLs that target private networks or non-http(s) schemes.
 * Used for admin-configured provider base URLs and absolute balance endpoints.
 */
export function assertSafeOutboundUrl(rawUrl: string, label = 'URL'): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.OUTBOUND_URL.INVALID, { label });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.OUTBOUND_URL.SCHEME, { label });
  }
  if (parsed.username || parsed.password) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.OUTBOUND_URL.CREDENTIALS, { label });
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.OUTBOUND_URL.PRIVATE_NETWORK, { label });
  }
}

/**
 * An explicit proxy is dialed by undici's `ProxyAgent` (http/https only) and
 * still carries the provider `Authorization` header to whatever host it points
 * at, so it needs the same host/credential rules as any other outbound target.
 * Empty means "no explicit proxy", which is always valid.
 */
export function assertSafeProxyUrl(rawUrl: string | null | undefined, label = '代理地址'): void {
  if (!rawUrl?.trim()) {
    return;
  }
  assertSafeOutboundUrl(rawUrl, label);
}

/** Resolve a provider balance endpoint that may be absolute or root-relative. */
export function resolveProviderBalanceUrl(baseUrl: string, balanceEndpoint: string): string {
  if (/^https?:\/\//i.test(balanceEndpoint)) {
    assertSafeOutboundUrl(balanceEndpoint, '余额端点');
    return balanceEndpoint;
  }
  const base = baseUrl.replace(/\/+$/, '');
  const path = balanceEndpoint.replace(/^\/+/, '');
  const resolved = `${base}/${path}`;
  assertSafeOutboundUrl(resolved, '余额端点');
  return resolved;
}
