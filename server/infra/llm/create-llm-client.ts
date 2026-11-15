import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

import { isRuntimeImplemented } from '@/shared/llm';

import { buildProxiedFetch } from '@/server/infra/llm/proxy';
import type { ResolvedLlm } from '@/server/infra/llm/resolve';
import { createSafeOutboundFetch } from '@/server/infra/llm/safe-fetch';
import { HTTP_STATUS } from '@/server/shared/constants';
import { AppError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';

export type CreateLlmClientOptions = {
  timeoutMs?: number;
  maxTokens?: number;
  maxRetries?: number;
  enableThinking?: boolean;
  jsonObject?: boolean;
};

/**
 * Build a Vercel AI SDK language model for the resolved OpenAI-compatible provider (T1).
 * `wireVariant` selects Chat Completions vs Responses; structured/JSON output is
 * requested per call through `generateText({ output })`, not through the model.
 */
export function createLlmClient(resolved: ResolvedLlm, _options?: CreateLlmClientOptions): LanguageModel {
  if (!isRuntimeImplemented(resolved.apiFamily)) {
    throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.LLM.FAMILY_NOT_IMPLEMENTED, {
      apiFamily: resolved.apiFamily,
    });
  }

  if (resolved.apiFamily !== 'openai') {
    throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.LLM.FAMILY_NOT_IMPLEMENTED, {
      apiFamily: resolved.apiFamily,
    });
  }

  const proxiedFetch = buildProxiedFetch(resolved.proxyUrl);
  const openai = createOpenAI({
    apiKey: resolved.apiKey,
    baseURL: resolved.baseUrl,
    fetch: createSafeOutboundFetch(proxiedFetch),
  });

  return resolved.wireVariant === 'responses' ? openai.responses(resolved.modelId) : openai.chat(resolved.modelId);
}
