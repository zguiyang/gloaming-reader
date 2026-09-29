import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getUserTtsConfig,
  listUserLlmProviders,
  putUserTtsConfig,
  updateUserLlmProvider,
} from '@/features/settings/settings-api';

afterEach(() => vi.unstubAllGlobals());

describe('user settings API', () => {
  it('loads personal providers from the User Settings API and only stores a masked key', async () => {
    const provider = {
      id: 'provider-id',
      apiFamily: 'openai',
      name: 'Personal API',
      baseUrl: 'https://api.example.com/v1',
      proxyUrl: null,
      thinkingParam: null,
      balanceEndpoint: null,
      balanceAmountPath: null,
      balanceCurrencyPath: null,
      isEnabled: true,
      apiKeySet: true,
      apiKeyMasked: 'sk-••••last',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify([provider]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await listUserLlmProviders();

    expect(result).toEqual([provider]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/settings/llm/providers');
    expect(JSON.stringify(result)).not.toContain('apiKey"');
  });

  it('keeps an existing LLM secret untouched when only public fields are updated', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'provider-id',
          apiFamily: 'openai',
          name: 'Updated',
          baseUrl: 'https://api.example.com/v1',
          proxyUrl: null,
          thinkingParam: null,
          balanceEndpoint: null,
          balanceAmountPath: null,
          balanceCurrencyPath: null,
          isEnabled: true,
          apiKeySet: true,
          apiKeyMasked: 'sk-••••last',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await updateUserLlmProvider('provider-id', { name: 'Updated' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/settings/llm/providers/provider-id');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Updated' });
    expect(String(init.body)).not.toContain('apiKey');
  });

  it('loads the personal TTS DTO from its User Settings endpoint', async () => {
    const config = {
      configured: false,
      provider: 'azure',
      region: '',
      isEnabled: false,
      apiKeySet: false,
      apiKeyMasked: null,
      defaultVoice: 'en-US-JennyNeural',
      usVoice: 'en-US-JennyNeural',
      ukVoice: 'en-GB-SoniaNeural',
      updatedAt: null,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(config), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    expect(await getUserTtsConfig()).toEqual(config);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/settings/tts/config');
  });

  it('omits an unchanged TTS key from explicit configuration updates', async () => {
    const config = {
      configured: true,
      provider: 'azure',
      region: 'eastus',
      isEnabled: true,
      apiKeySet: true,
      apiKeyMasked: '••••last',
      defaultVoice: 'en-US-JennyNeural',
      usVoice: 'en-US-JennyNeural',
      ukVoice: 'en-GB-SoniaNeural',
      updatedAt: new Date().toISOString(),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(config), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await putUserTtsConfig({
      region: 'eastus',
      isEnabled: true,
      defaultVoice: config.defaultVoice,
      usVoice: config.usVoice,
      ukVoice: config.ukVoice,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/settings/tts/config');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).not.toHaveProperty('apiKey');
  });
});
