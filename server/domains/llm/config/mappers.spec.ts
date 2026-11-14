import { describe, expect, it, vi } from 'vitest';

// The mappers only need table types; mock the runtime modules so this stays a
// pure unit test without loading database/env configuration.
vi.mock('@/server/db', () => ({ llmModel: {}, llmProvider: {} }));
vi.mock('@/server/infra/llm', () => ({
  decryptApiKey: (ciphertext: string) => {
    if (ciphertext === 'broken') throw new Error('cannot decrypt');
    return 'sk-test-abcdefgh1234';
  },
  maskApiKey: (plaintext: string) => {
    const trimmed = plaintext.trim();
    return trimmed.length <= 4 ? '****' : `${trimmed.slice(0, 3)}…${trimmed.slice(-4)}`;
  },
}));

import { toModelView, toProviderView } from './mappers';

type ProviderRow = Parameters<typeof toProviderView>[0];
type ModelRow = Parameters<typeof toModelView>[0];

function providerRow(overrides: Partial<ProviderRow>): ProviderRow {
  return {
    id: 'provider-1',
    apiFamily: 'openai',
    name: 'Example',
    baseUrl: 'https://api.example.com/v1',
    proxyUrl: null,
    thinkingParam: null,
    balanceEndpoint: null,
    balanceAmountPath: null,
    balanceCurrencyPath: null,
    isEnabled: true,
    apiKeyCiphertext: 'v1:whatever',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T03:04:05.000Z'),
    ...overrides,
  } as ProviderRow;
}

describe('LLM config mappers', () => {
  it('shapes a provider row without exposing the plaintext key', () => {
    expect(toProviderView(providerRow({}))).toEqual({
      id: 'provider-1',
      apiFamily: 'openai',
      name: 'Example',
      baseUrl: 'https://api.example.com/v1',
      proxyUrl: null,
      thinkingParam: null,
      balanceEndpoint: null,
      balanceAmountPath: null,
      balanceCurrencyPath: null,
      isEnabled: true,
      apiKeySet: true,
      apiKeyMasked: 'sk-…1234',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T03:04:05.000Z',
    });
  });

  it('falls back to a fixed mask when the ciphertext cannot be decrypted', () => {
    const view = toProviderView(providerRow({ apiKeyCiphertext: 'broken' }));
    expect(view.apiKeyMasked).toBe('****');
    expect(view.apiKeySet).toBe(true);
  });

  it('shapes a model row and serializes timestamps', () => {
    const row = {
      id: 'model-1',
      providerId: 'provider-1',
      modelId: 'gpt-test',
      label: 'GPT Test',
      wireVariant: 'responses',
      contextLength: 128000,
      temperature: 0.7,
      maxTokens: 2048,
      isEnabled: true,
      sortOrder: 3,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T03:04:05.000Z'),
    } as ModelRow;

    expect(toModelView(row)).toEqual({
      id: 'model-1',
      providerId: 'provider-1',
      modelId: 'gpt-test',
      label: 'GPT Test',
      wireVariant: 'responses',
      contextLength: 128000,
      temperature: 0.7,
      maxTokens: 2048,
      isEnabled: true,
      sortOrder: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T03:04:05.000Z',
    });
  });
});
