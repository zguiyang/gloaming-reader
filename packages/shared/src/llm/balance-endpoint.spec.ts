import { describe, expect, it } from 'vitest';

import { normalizeBalanceEndpoint } from './balance-endpoint.ts';

describe('normalizeBalanceEndpoint', () => {
  const baseUrl = 'https://api.ofox.io/v1';

  it('accepts relative paths with or without a leading slash', () => {
    expect(normalizeBalanceEndpoint('user/balance', baseUrl)).toEqual({ ok: true, value: 'user/balance' });
    expect(normalizeBalanceEndpoint('/user/balance', baseUrl)).toEqual({ ok: true, value: 'user/balance' });
  });

  it('strips same-origin absolute URLs down to a path', () => {
    expect(normalizeBalanceEndpoint('https://api.ofox.io/v1/user/balance', baseUrl)).toEqual({
      ok: true,
      value: 'user/balance',
    });
  });

  it('keeps absolute URLs on a different origin', () => {
    const absolute = 'https://billing.example.com/v1/credits';
    expect(normalizeBalanceEndpoint(absolute, baseUrl)).toEqual({ ok: true, value: absolute });
  });

  it('rejects malformed protocol prefixes', () => {
    expect(normalizeBalanceEndpoint('https:/api.ofox.io/v1/user/balance', baseUrl).ok).toBe(false);
  });
});
