import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildProxiedFetch } from '@/lib/llm/proxy';

/** Clear inherited shell proxy vars so cases assert the intended path only. */
function clearProxyEnv(): void {
  for (const key of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'all_proxy'] as const) {
    vi.stubEnv(key, '');
  }
}

describe('buildProxiedFetch', () => {
  beforeEach(() => {
    clearProxyEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns undefined when neither proxyUrl nor env proxy vars exist (direct path)', () => {
    expect(buildProxiedFetch(null)).toBeUndefined();
  });

  it('uses the explicit proxyUrl when configured', () => {
    const wrapped = buildProxiedFetch('http://127.0.0.1:7897');
    expect(typeof wrapped).toBe('function');
  });

  it('falls back to env vars when proxyUrl is absent', () => {
    vi.stubEnv('http_proxy', 'http://127.0.0.1:7897');
    expect(typeof buildProxiedFetch(null)).toBe('function');
  });

  it('env fallback respects uppercase proxy vars', () => {
    vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:7897');
    expect(typeof buildProxiedFetch(null)).toBe('function');
  });
});
