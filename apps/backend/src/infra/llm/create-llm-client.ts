import { ChatOpenAI } from '@langchain/openai';

import { isRuntimeImplemented } from '@gloaming/shared/llm';

import { buildProxiedFetch } from '@/infra/llm/proxy';
import type { ResolvedLlm } from '@/infra/llm/resolve';
import { HTTP_STATUS } from '@/shared/constants';
import { AppError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 1;

export type CreateLlmClientOptions = {
  timeoutMs?: number;
  /** Thinking-mode toggle; parameter name comes from `ResolvedLlm.thinkingParam`. */
  enableThinking?: boolean;
};

function createOpenAiClient(resolved: ResolvedLlm, options?: CreateLlmClientOptions): ChatOpenAI {
  const proxiedFetch = buildProxiedFetch(resolved.proxyUrl);
  const modelKwargs =
    resolved.thinkingParam && options?.enableThinking !== undefined
      ? { [resolved.thinkingParam]: options.enableThinking }
      : undefined;
  return new ChatOpenAI({
    model: resolved.modelId,
    apiKey: resolved.apiKey,
    temperature: resolved.temperature ?? undefined,
    maxTokens: resolved.maxTokens ?? undefined,
    timeout: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
    configuration: {
      baseURL: resolved.baseUrl,
      ...(proxiedFetch ? { fetch: proxiedFetch } : {}),
    },
    ...(modelKwargs ? { modelKwargs } : {}),
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
