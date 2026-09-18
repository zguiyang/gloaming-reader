import { HTTP_STATUS } from '@/constants';
import { AppError } from '@/lib/errors/app-error';
import { ERROR_CODES } from '@/lib/errors/codes';

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

function isBlockedHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!normalized) {
    return true;
  }
  if (BLOCKED_HOSTNAMES.has(normalized)) {
    return true;
  }
  if (normalized.endsWith('.localhost')) {
    return true;
  }
  if (
    normalized === '::1' ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd')
  ) {
    return true;
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
