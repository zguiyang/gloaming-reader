import { AIMessage, type AIMessageChunk, HumanMessage, ToolMessage } from '@langchain/core/messages';
import type { z, ZodTypeAny } from 'zod';

import { HTTP_STATUS } from '@/constants';
import { AppError } from '@/lib/errors/app-error';
import { ERROR_CODES } from '@/lib/errors/codes';
import { createLlmClient, type ResolvedLlm, resolveLlmByModelRowId } from '@/lib/llm';
import { rootLogger } from '@/lib/logger';
import { recordInvocation, truncatePreview } from '@/modules/ai/invocations/log';
import {
  addUsage,
  emptyTokens,
  messageContentToString,
  replyTextFromContent,
  toBaseMessages,
} from '@/modules/ai/runtime/messages';
import { resolveModelRowId } from '@/modules/ai/runtime/purpose-model';
import { buildRequestSummary } from '@/modules/ai/runtime/request-summary';
import type { AiInvokeOptions, AiInvokeResult, AiStreamEvent, AiStreamOptions } from '@/modules/ai/runtime/types';

const aiLogger = rootLogger.child({ module: 'Ai' });
const DEFAULT_MAX_TOOL_ROUNDS = 3;

export type {
  AiInvokeOptions,
  AiInvokeRef,
  AiInvokeResult,
  AiMessageInput,
  AiStreamDeltaEvent,
  AiStreamDoneEvent,
  AiStreamEvent,
  AiStreamOptions,
} from '@/modules/ai/runtime/types';

/**
 * Global AI entry: resolve purpose/model, invoke LangChain chat (optional tools), audit log.
 * Other modules must call this — not `lib/llm` directly for business invokes.
 */
export async function invokeAi<TSchema extends ZodTypeAny | undefined = undefined>(
  options: AiInvokeOptions<TSchema>,
): Promise<AiInvokeResult<TSchema extends ZodTypeAny ? z.infer<TSchema> : string>> {
  const started = Date.now();
  const tokens = emptyTokens();
  let resolved: ResolvedLlm | undefined;
  let toolRoundCount = 0;
  const purpose = options.purpose ?? (options.modelRowId ? null : 'assist');

  try {
    const modelRowId = await resolveModelRowId(options);
    resolved = await resolveLlmByModelRowId(modelRowId);
    const chat = createLlmClient(resolved, {
      timeoutMs: options.timeoutMs,
      enableThinking: options.enableThinking ?? false,
    });
    const conversation = toBaseMessages(options.messages);
    const tools = options.tools ?? [];
    const maxRounds = options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;

    let lastAi: AIMessage | undefined;

    if (tools.length > 0) {
      const bound = chat.bindTools(tools);
      for (let round = 0; round < maxRounds; round += 1) {
        const aiMessage = (await bound.invoke(conversation)) as AIMessage;
        addUsage(tokens, aiMessage.usage_metadata);
        lastAi = aiMessage;
        const toolCalls = aiMessage.tool_calls ?? [];
        if (toolCalls.length === 0) {
          break;
        }
        toolRoundCount += 1;
        conversation.push(aiMessage);
        for (const call of toolCalls) {
          const matched = tools.find((t) => t.name === call.name);
          if (!matched) {
            conversation.push(
              new ToolMessage({
                content: `Unknown tool: ${call.name}`,
                tool_call_id: call.id ?? call.name,
              }),
            );
            continue;
          }
          const raw = await matched.invoke(call.args);
          conversation.push(
            new ToolMessage({
              content: typeof raw === 'string' ? raw : JSON.stringify(raw),
              tool_call_id: call.id ?? call.name,
            }),
          );
        }
      }
    }

    type ContentOut = TSchema extends ZodTypeAny ? z.infer<TSchema> : string;
    let content: ContentOut;

    if (options.outputSchema) {
      // After tool rounds the model may emit prose; force a structured turn.
      conversation.push(
        new HumanMessage(
          'Respond now with the required structured fields only (valid JSON matching the schema). Do not write free-form prose.',
        ),
      );
      const structured = chat.withStructuredOutput(options.outputSchema, { method: 'jsonSchema', strict: true });
      content = (await structured.invoke(conversation)) as ContentOut;
    } else if (lastAi) {
      content = messageContentToString(lastAi.content) as ContentOut;
    } else {
      const aiMessage = (await chat.invoke(conversation)) as AIMessage;
      addUsage(tokens, aiMessage.usage_metadata);
      lastAi = aiMessage;
      content = messageContentToString(aiMessage.content) as ContentOut;
    }

    const replyText = replyTextFromContent(content);

    await recordInvocation({
      status: 'success',
      purpose,
      source: options.source,
      userId: options.userId,
      refType: options.ref?.type,
      refId: options.ref?.id,
      modelRowId: resolved.modelRowId,
      providerId: resolved.providerId,
      modelId: resolved.modelId,
      baseUrl: resolved.baseUrl,
      latencyMs: Date.now() - started,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      totalTokens: tokens.totalTokens,
      requestSummary: buildRequestSummary(options, toolRoundCount),
      responseSummary: {
        replyPreview: truncatePreview(replyText),
        replyLength: replyText.length,
      },
    });

    return {
      content,
      model: { rowId: resolved.modelRowId, label: resolved.label, modelId: resolved.modelId },
      usage: tokens,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI invoke failed';
    const statusCode = error instanceof AppError ? error.statusCode : HTTP_STATUS.SERVICE_UNAVAILABLE;

    if (!(error instanceof AppError)) {
      aiLogger.error({ err: error, source: options.source, purpose }, 'AI invoke failed');
    }

    await recordInvocation({
      status: 'failure',
      errorCode: String(statusCode),
      errorMessage: message,
      purpose,
      source: options.source,
      userId: options.userId,
      refType: options.ref?.type,
      refId: options.ref?.id,
      modelRowId: resolved?.modelRowId,
      providerId: resolved?.providerId,
      modelId: resolved?.modelId,
      baseUrl: resolved?.baseUrl,
      latencyMs: Date.now() - started,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      totalTokens: tokens.totalTokens,
      requestSummary: buildRequestSummary(options, toolRoundCount),
    });

    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.AI.UNAVAILABLE);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * Global AI streaming entry: same resolve/audit path as invokeAi, yields plain-text deltas.
 * Tool rounds stream each model turn; clients typically only show the final answer text.
 */
export async function* streamAi(options: AiStreamOptions): AsyncGenerator<AiStreamEvent> {
  const started = Date.now();
  const tokens = emptyTokens();
  let resolved: ResolvedLlm | undefined;
  let toolRoundCount = 0;
  const purpose = options.purpose ?? (options.modelRowId ? null : 'assist');
  const runConfig = options.signal ? { signal: options.signal } : undefined;

  try {
    if (options.signal?.aborted) {
      return;
    }

    const modelRowId = await resolveModelRowId(options);
    resolved = await resolveLlmByModelRowId(modelRowId);
    const chat = createLlmClient(resolved, {
      timeoutMs: options.timeoutMs,
      enableThinking: options.enableThinking ?? false,
    });
    const conversation = toBaseMessages(options.messages);
    const tools = options.tools ?? [];
    const maxRounds = options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;

    let replyText = '';

    if (tools.length > 0) {
      const bound = chat.bindTools(tools);
      for (let round = 0; round < maxRounds; round += 1) {
        if (options.signal?.aborted) {
          return;
        }

        let assembled: AIMessageChunk | null = null;
        for await (const chunk of await bound.stream(conversation, runConfig)) {
          if (options.signal?.aborted) {
            return;
          }
          assembled = assembled ? assembled.concat(chunk) : chunk;
          const text = messageContentToString(chunk.content);
          if (text) {
            yield { type: 'delta', text };
          }
        }

        if (!assembled) {
          break;
        }

        addUsage(tokens, assembled.usage_metadata);
        const toolCalls = assembled.tool_calls ?? [];
        replyText = messageContentToString(assembled.content);

        if (toolCalls.length === 0) {
          break;
        }

        toolRoundCount += 1;
        conversation.push(
          new AIMessage({
            content: assembled.content,
            tool_calls: toolCalls,
          }),
        );

        for (const call of toolCalls) {
          const matched = tools.find((t) => t.name === call.name);
          if (!matched) {
            conversation.push(
              new ToolMessage({
                content: `Unknown tool: ${call.name}`,
                tool_call_id: call.id ?? call.name,
              }),
            );
            continue;
          }
          const raw = await matched.invoke(call.args, runConfig);
          conversation.push(
            new ToolMessage({
              content: typeof raw === 'string' ? raw : JSON.stringify(raw),
              tool_call_id: call.id ?? call.name,
            }),
          );
        }
      }
    } else {
      let assembled: AIMessageChunk | null = null;
      for await (const chunk of await chat.stream(conversation, runConfig)) {
        if (options.signal?.aborted) {
          return;
        }
        assembled = assembled ? assembled.concat(chunk) : chunk;
        const text = messageContentToString(chunk.content);
        if (text) {
          yield { type: 'delta', text };
        }
      }
      if (assembled) {
        addUsage(tokens, assembled.usage_metadata);
        replyText = messageContentToString(assembled.content);
      }
    }

    if (options.signal?.aborted) {
      return;
    }

    if (!replyText.trim()) {
      throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.AI.UNAVAILABLE);
    }

    await recordInvocation({
      status: 'success',
      purpose,
      source: options.source,
      userId: options.userId,
      refType: options.ref?.type,
      refId: options.ref?.id,
      modelRowId: resolved.modelRowId,
      providerId: resolved.providerId,
      modelId: resolved.modelId,
      baseUrl: resolved.baseUrl,
      latencyMs: Date.now() - started,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      totalTokens: tokens.totalTokens,
      requestSummary: buildRequestSummary(options, toolRoundCount),
      responseSummary: {
        replyPreview: truncatePreview(replyText),
        replyLength: replyText.length,
      },
    });

    yield {
      type: 'done',
      content: replyText,
      model: { rowId: resolved.modelRowId, label: resolved.label, modelId: resolved.modelId },
      usage: tokens,
    };
  } catch (error) {
    if (isAbortError(error) || options.signal?.aborted) {
      return;
    }

    const message = error instanceof Error ? error.message : 'AI stream failed';
    const statusCode = error instanceof AppError ? error.statusCode : HTTP_STATUS.SERVICE_UNAVAILABLE;

    await recordInvocation({
      status: 'failure',
      errorCode: String(statusCode),
      errorMessage: message,
      purpose,
      source: options.source,
      userId: options.userId,
      refType: options.ref?.type,
      refId: options.ref?.id,
      modelRowId: resolved?.modelRowId,
      providerId: resolved?.providerId,
      modelId: resolved?.modelId,
      baseUrl: resolved?.baseUrl,
      latencyMs: Date.now() - started,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      totalTokens: tokens.totalTokens,
      requestSummary: buildRequestSummary(options, toolRoundCount),
    });

    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.AI.UNAVAILABLE);
  }
}
