import { describe, expect, it } from 'vitest';

import { AppError } from '@/lib/errors/app-error';
import { ERROR_CODES } from '@/lib/errors/codes';
import { createLlmClient } from '@/lib/llm/create-llm-client';
import type { ResolvedLlm } from '@/lib/llm/resolve';

function resolved(
  modelId: string,
  wireVariant: ResolvedLlm['wireVariant'] = 'chat-completions',
  thinkingParam: string | null = null,
): ResolvedLlm {
  return {
    modelRowId: 'row',
    providerId: 'provider',
    providerName: 'Test Provider',
    apiFamily: 'openai',
    label: 'test',
    modelId,
    wireVariant,
    baseUrl: 'https://example.com/v1',
    apiKey: 'sk-test',
    proxyUrl: null,
    thinkingParam,
    temperature: 0.2,
    maxTokens: 2048,
  };
}

describe('createLlmClient', () => {
  it('uses Chat Completions wire variant by default (explicit opt-out)', () => {
    const chat = createLlmClient(resolved('qwen3.7-plus'));
    expect(chat.useResponsesApi).toBe(false);
  });

  it('uses Responses API when wire variant is responses', () => {
    const chat = createLlmClient(resolved('qwen3.7-plus', 'responses'));
    expect(chat.useResponsesApi).toBe(true);
  });

  it('routing is driven by wire variant config, not model name', () => {
    const chatCompletions = createLlmClient(resolved('openai/gpt-5.4-pro'));
    expect(chatCompletions.useResponsesApi).toBe(false);

    const responses = createLlmClient(resolved('deepseek-v4-flash', 'responses'));
    expect(responses.useResponsesApi).toBe(true);
  });

  it('passes through model params and base URL', () => {
    const chat = createLlmClient(resolved('qwen3.7-plus', 'responses'), { timeoutMs: 30_000 });
    expect(chat.model).toBe('qwen3.7-plus');
    expect(chat.temperature).toBe(0.2);
    expect(chat.maxTokens).toBe(2048);
    expect(chat.clientConfig.baseURL).toBe('https://example.com/v1');
  });

  it('forwards thinking toggle with the provider-declared parameter name', () => {
    const chat = createLlmClient(resolved('qwen3.7-plus', 'chat-completions', 'enable_thinking'), {
      enableThinking: false,
    });
    expect(chat.modelKwargs).toEqual({ enable_thinking: false });
  });

  it('rejects unimplemented API families', () => {
    try {
      createLlmClient({
        ...resolved('claude-3'),
        apiFamily: 'anthropic',
        wireVariant: 'messages',
      });
      expect.unreachable('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(503);
      expect((error as AppError).code).toBe(ERROR_CODES.LLM.FAMILY_NOT_IMPLEMENTED);
    }
  });
});
