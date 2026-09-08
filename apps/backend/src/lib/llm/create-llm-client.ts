import { ChatOpenAI } from '@langchain/openai';

import { isRuntimeImplemented } from '@gloaming/shared/llm';

import { HTTP_STATUS } from '@/constants';
import { AppError } from '@/lib/errors';
import { buildProxiedFetch } from '@/lib/llm/proxy';
import type { ResolvedLlm } from '@/lib/llm/resolve';

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
    throw new AppError(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      `LLM API family "${resolved.apiFamily}" is registered but runtime support is not implemented.`,
    );
  }

  switch (resolved.apiFamily) {
    case 'openai':
      return createOpenAiClient(resolved, options);
    default:
      throw new AppError(
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        `LLM API family "${resolved.apiFamily}" is registered but runtime support is not implemented.`,
      );
  }
}

/** @deprecated Use createLlmClient — kept for tests during migration. */
export const createChatModel = createLlmClient;

export type CreateChatModelOptions = CreateLlmClientOptions;
