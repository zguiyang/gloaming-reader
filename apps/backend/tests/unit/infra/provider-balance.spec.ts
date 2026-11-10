import { describe, expect, it, vi } from 'vitest';

vi.mock('@/infra/llm/proxy', () => ({
  buildProxiedFetch: () => undefined,
}));

import { queryProviderBalance } from '@/infra/llm/provider-introspect';

const providerRow = {
  id: 'provider-1',
  apiFamily: 'openai',
  name: 'Ofox',
  baseUrl: 'https://api.ofox.io/v1',
  apiKeyCiphertext: 'cipher',
  proxyUrl: null,
  thinkingParam: null,
  balanceEndpoint: 'user/balance',
  balanceAmountPath: 'balance',
  balanceCurrencyPath: 'currency',
  isEnabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
} as const;

describe('queryProviderBalance', () => {
  it('parses Ofox-style root balance fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          is_active: true,
          balance: 42.1357,
          total: 100,
          used: 57.8643,
          currency: 'USD',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await queryProviderBalance(providerRow, 'sk-test');

    expect(result).toEqual({
      supported: true,
      balance: 42.1357,
      currency: 'USD',
      used: 57.8643,
      isAvailable: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.ofox.io/v1/user/balance',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
      }),
    );

    vi.unstubAllGlobals();
  });

  it('reports parse-failed when configured path does not match', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ balance: 10, currency: 'USD' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await queryProviderBalance({ ...providerRow, balanceAmountPath: 'data.balance' }, 'sk-test');

    expect(result).toEqual({
      supported: false,
      reason: 'parse-failed',
      message: '无法按路径解析余额：data.balance',
    });

    vi.unstubAllGlobals();
  });
});
