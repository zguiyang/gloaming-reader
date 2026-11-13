import { describe, expect, it } from 'vitest';

import { AppError } from '@/server/shared/errors/app-error';
import { assertSafeOutboundUrl, assertSafeProxyUrl, resolveProviderBalanceUrl } from '@/server/infra/llm/outbound-url';

function rejectionCode(url: string): string | null {
  try {
    assertSafeOutboundUrl(url, 'test');
    return null;
  } catch (error) {
    return error instanceof AppError ? error.code : `unexpected:${String(error)}`;
  }
}

describe('assertSafeOutboundUrl', () => {
  it('rejects private and link-local IPv4 targets', () => {
    for (const url of [
      'http://127.0.0.1/',
      'http://10.1.2.3/',
      'http://169.254.169.254/latest/meta-data/',
      'http://172.16.0.1/',
      'http://192.168.1.1/',
      'http://0.0.0.0/',
    ]) {
      expect(rejectionCode(url), `${url} should be blocked`).toBe('api.errors.outboundUrl.privateNetwork');
    }
  });

  it('rejects IPv6 internal targets regardless of bracket spelling', () => {
    // `URL.hostname` keeps the brackets (`http://[::1]` → `[::1]`); the guard used
    // to compare the bracketed literal against `::1` and silently allowed it.
    for (const url of [
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:a00:1]/',
      'http://[fd00::1]/',
      'http://[fc00::1]/',
      'http://[fe80::1]/',
      'http://[ff02::1]/',
    ]) {
      expect(rejectionCode(url), `${url} should be blocked`).toBe('api.errors.outboundUrl.privateNetwork');
    }
  });

  it('rejects blocked hostnames, bad schemes and embedded credentials', () => {
    expect(rejectionCode('http://localhost/v1')).toBe('api.errors.outboundUrl.privateNetwork');
    expect(rejectionCode('http://api.localhost/v1')).toBe('api.errors.outboundUrl.privateNetwork');
    expect(rejectionCode('http://metadata.google.internal/')).toBe('api.errors.outboundUrl.privateNetwork');
    expect(rejectionCode('ftp://example.com/')).toBe('api.errors.outboundUrl.scheme');
    expect(rejectionCode('http://user:pass@example.com/')).toBe('api.errors.outboundUrl.credentials');
    expect(rejectionCode('not a url')).toBe('api.errors.outboundUrl.invalid');
  });

  it('allows public IPv4 and IPv6 targets', () => {
    expect(rejectionCode('https://api.openai.com/v1')).toBeNull();
    expect(rejectionCode('http://203.0.113.10/v1')).toBeNull();
    expect(rejectionCode('https://[2606:4700:4700::1111]/')).toBeNull();
  });
});

describe('assertSafeProxyUrl', () => {
  it('treats an empty value as "no explicit proxy"', () => {
    expect(() => assertSafeProxyUrl(undefined)).not.toThrow();
    expect(() => assertSafeProxyUrl(null)).not.toThrow();
    expect(() => assertSafeProxyUrl('   ')).not.toThrow();
  });

  it('applies the same host rules as any other outbound URL', () => {
    expect(() => assertSafeProxyUrl('http://169.254.169.254/')).toThrow(AppError);
    expect(() => assertSafeProxyUrl('http://[::1]:3128/')).toThrow(AppError);
    // undici's ProxyAgent only dials http/https.
    expect(() => assertSafeProxyUrl('socks5://127.0.0.1:1080')).toThrow(AppError);
    expect(() => assertSafeProxyUrl('http://proxy.example.com:8080')).not.toThrow();
  });
});

describe('resolveProviderBalanceUrl', () => {
  it('joins a path onto the base URL and re-validates the result', () => {
    expect(resolveProviderBalanceUrl('https://api.example.com/v1', '/user/balance')).toBe(
      'https://api.example.com/v1/user/balance',
    );
  });

  it('validates an absolute balance endpoint', () => {
    expect(() => resolveProviderBalanceUrl('https://api.example.com', 'http://127.0.0.1/balance')).toThrow(AppError);
  });
});
