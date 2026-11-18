import { afterEach, describe, expect, it } from 'vitest';

import {
  buildProxiedFetch,
  normalizeProxyUrl,
  resolveOutboundFetch,
  resolveProxyUrlFromEnv,
} from '@/server/infra/http/proxied-fetch';

describe('normalizeProxyUrl', () => {
  it('returns null for empty input', () => {
    expect(normalizeProxyUrl(null)).toBeNull();
    expect(normalizeProxyUrl('  ')).toBeNull();
  });

  it('accepts http(s) localhost proxies used in local/China egress setups', () => {
    expect(normalizeProxyUrl('http://127.0.0.1:7890')).toBe('http://127.0.0.1:7890');
    expect(normalizeProxyUrl('https://proxy.example.com:8443')).toBe('https://proxy.example.com:8443');
  });

  it('rejects non-http schemes', () => {
    expect(() => normalizeProxyUrl('socks5://127.0.0.1:1080')).toThrow(/http/i);
  });
});

describe('resolveProxyUrlFromEnv', () => {
  afterEach(() => {
    delete process.env.FIRST_PROXY_URL;
    delete process.env.SECOND_PROXY_URL;
  });

  it('prefers the first configured channel key', () => {
    process.env.SECOND_PROXY_URL = 'http://127.0.0.1:1';
    process.env.FIRST_PROXY_URL = 'http://127.0.0.1:7890';
    expect(resolveProxyUrlFromEnv('FIRST_PROXY_URL', 'SECOND_PROXY_URL')).toBe('http://127.0.0.1:7890');
  });

  it('returns null when none are set', () => {
    expect(resolveProxyUrlFromEnv('FIRST_PROXY_URL', 'SECOND_PROXY_URL')).toBeNull();
  });
});

describe('buildProxiedFetch / resolveOutboundFetch', () => {
  const proxyEnvKeys = ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY'] as const;
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of proxyEnvKeys) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
      delete saved[key];
    }
  });

  function clearProxyEnv() {
    for (const key of proxyEnvKeys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  }

  it('returns undefined when no explicit or env proxy is configured', () => {
    clearProxyEnv();
    expect(buildProxiedFetch(null)).toBeUndefined();
    expect(typeof resolveOutboundFetch(null)).toBe('function');
  });

  it('returns a function when an explicit proxy URL is set', () => {
    clearProxyEnv();
    const proxied = buildProxiedFetch('http://127.0.0.1:7890');
    expect(typeof proxied).toBe('function');
  });
});
