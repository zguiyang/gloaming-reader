import { ChatOpenAI } from '@langchain/openai';

import { isRuntimeImplemented } from '@gloaming/shared/llm';

import { buildProxiedFetch } from '@/server/infra/llm/proxy';
import type { ResolvedLlm } from '@/server/infra/llm/resolve';
import { HTTP_STATUS } from '@/server/shared/constants';
import { AppError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 1;

export type CreateLlmClientOptions = {
  timeoutMs?: number;
  maxTokens?: number;
  maxRetries?: number;
  /** Thinking-mode toggle; parameter name comes from `ResolvedLlm.thinkingParam`. */
  enableThinking?: boolean;
  /**
   * Prefer Chat Completions `response_format: json_object` when the wire supports it.
   * Skipped for Responses-API wires (gateways often reject or remap that field).
   */
  jsonObject?: boolean;
};

function createOpenAiClient(resolved: ResolvedLlm, options?: CreateLlmClientOptions): ChatOpenAI {
  const proxiedFetch = buildProxiedFetch(resolved.proxyUrl);
  const modelKwargs: Record<string, unknown> = {};
  if (resolved.thinkingParam && options?.enableThinking !== undefined) {
    modelKwargs[resolved.thinkingParam] = options.enableThinking;
  }
  // json_object is a Chat Completions affordance; Responses wires use a different format surface.
  if (options?.jsonObject && resolved.wireVariant !== 'responses') {
    modelKwargs.response_format = { type: 'json_object' };
  }
  return new ChatOpenAI({
    model: resolved.modelId,
    apiKey: resolved.apiKey,
    temperature: resolved.temperature ?? undefined,
    maxTokens: options?.maxTokens ?? resolved.maxTokens ?? undefined,
    timeout: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRetries: options?.maxRetries ?? DEFAULT_MAX_RETRIES,
    configuration: {
      baseURL: resolved.baseUrl,
      ...(proxiedFetch ? { fetch: proxiedFetch } : {}),
    },
    ...(Object.keys(modelKwargs).length > 0 ? { modelKwargs } : {}),
    useResponsesApi: resolved.wireVariant === 'responses',
  });
}

/**
 * Build a LangChain chat client for the resolved model's API family + wire variant.
 */
export function createLlmClient(resolved: ResolvedLlm, options?: CreateLlmClientOptions): ChatOpenAI {
  if (!isRuntimeImplemented(resolved.apiFamily)) {
    throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.LLM.FAMILY_NOT_IMPLEMENTED, {
      apiFamily: resolved.apiFamily,
    });
  }

  switch (resolved.apiFamily) {
    case 'openai':
      return createOpenAiClient(resolved, options);
    default:
      throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.LLM.FAMILY_NOT_IMPLEMENTED, {
        apiFamily: resolved.apiFamily,
      });
  }
}
