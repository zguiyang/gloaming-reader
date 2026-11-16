import { generateText, NoObjectGeneratedError, Output, stepCountIs, streamText, tool } from 'ai';
import type { z, ZodTypeAny } from 'zod';

import { recordInvocation } from '@/server/domains/ai/invocations/log';
import { resolveModelRowId } from '@/server/domains/ai/runtime/purpose-model';
import type {
  AiInvokeOptions,
  AiInvokeResult,
  AiMessageInput,
  AiStreamEvent,
  AiStreamOptions,
  AiToolHandle,
} from '@/server/domains/ai/runtime/types';
import { createLlmClient, type ResolvedLlm, resolveLlmByModelRowId } from '@/server/infra/llm';
import { createLogger } from '@/server/infra/logging/logger';
import { HTTP_STATUS } from '@/server/shared/constants';
import { AppError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';

const aiLogger = createLogger('Ai');
const DEFAULT_MAX_TOOL_ROUNDS = 5;

function toAiSdkTools(handles: AiToolHandle[] | undefined) {
  if (!handles?.length) {
    return undefined;
  }
  return Object.fromEntries(
    handles.map((handle) => [
      handle.name,
      tool({
        description: handle.description,
        inputSchema: handle.inputSchema,
        execute: async (input) => handle.execute(input),
      }),
    ]),
  );
}

/** AI SDK rejects system role in `messages` unless allowed; prefer `instructions`. */
function toAiSdkPrompt(messages: AiMessageInput[]) {
  const systemParts: string[] = [];
  const conversation: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const message of messages) {
    if (message.role === 'system') {
      if (message.content.trim()) {
        systemParts.push(message.content);
      }
      continue;
    }
    conversation.push({ role: message.role, content: message.content });
  }
  return {
    ...(systemParts.length > 0 ? { instructions: systemParts.join('\n\n') } : {}),
    messages: conversation,
  };
}

export type {
  AiInvokeOptions,
  AiInvokeRef,
  AiInvokeResult,
  AiMessageInput,
  AiStreamDeltaEvent,
  AiStreamDoneEvent,
  AiStreamEvent,
  AiStreamOptions,
} from '@/server/domains/ai/runtime/types';

/**
 * Global AI entry via Vercel AI SDK (T1). Domains must call this — not infra/llm directly.
 */
export async function invokeAi<TSchema extends ZodTypeAny | undefined = undefined>(
  options: AiInvokeOptions<TSchema>,
): Promise<AiInvokeResult<TSchema extends ZodTypeAny ? z.infer<TSchema> : string>> {
  const started = Date.now();
  let resolved: ResolvedLlm | undefined;
  const purpose = options.purpose ?? (options.modelRowId ? null : 'assist');

  try {
    const modelRowId = await resolveModelRowId({
      modelRowId: options.modelRowId,
      purpose: purpose ?? undefined,
      userId: options.userId,
      providerScope: options.providerScope,
    });
    resolved = await resolveLlmByModelRowId(modelRowId);
    const model = createLlmClient(resolved, {
      timeoutMs: options.timeoutMs,
      maxTokens: options.maxTokens,
      maxRetries: options.maxRetries,
      enableThinking: options.enableThinking,
      jsonObject: options.jsonObject,
    });

    const tools = toAiSdkTools(options.tools);
    const prompt = toAiSdkPrompt(options.messages);
    // `createLlmClient` cannot carry per-call policy, so the configured timeout
    // and retry budget are applied here — otherwise they are silently dropped
    // and a stalled upstream hangs the request indefinitely.
    const callOptions = {
      model,
      ...prompt,
      ...(options.timeoutMs !== undefined ? { abortSignal: AbortSignal.timeout(options.timeoutMs) } : {}),
      ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
      maxOutputTokens: options.maxTokens ?? resolved.maxTokens ?? undefined,
      ...(tools
        ? {
            tools,
            stopWhen: stepCountIs(options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS),
          }
        : {}),
    };

    let content: unknown;
    let inputTokens = 0;
    let outputTokens = 0;
    const applyUsage = (usage: { inputTokens?: number; outputTokens?: number }) => {
      inputTokens = usage.inputTokens ?? 0;
      outputTokens = usage.outputTokens ?? 0;
    };

    if (options.outputSchema) {
      // Provider-native structured output; on gateways that reject/remap the
      // JSON schema, retry once with plain JSON mode and validate locally.
      try {
        const result = await generateText({
          ...callOptions,
          output: Output.object({ schema: options.outputSchema }),
        });
        content = result.output;
        applyUsage(result.usage);
      } catch (error) {
        if (!NoObjectGeneratedError.isInstance(error)) throw error;
        aiLogger.warn({ err: error, source: options.source }, 'Structured output failed; retrying with JSON mode');
        const result = await generateText({ ...callOptions, output: Output.json() });
        content = options.outputSchema.parse(result.output);
        applyUsage(result.usage);
      }
    } else if (options.jsonObject) {
      try {
        const result = await generateText({ ...callOptions, output: Output.json() });
        content = result.output;
        applyUsage(result.usage);
      } catch (error) {
        if (!NoObjectGeneratedError.isInstance(error)) throw error;
        // Hand the raw text back instead of failing. Callers such as the
        // dictionary enrichment run their own repair loop over it; throwing here
        // would bypass that loop entirely. Token usage is unavailable on this
        // path, so the invocation records zeros.
        aiLogger.warn({ err: error, source: options.source }, 'JSON output failed; returning raw text to caller');
        content = typeof error.text === 'string' ? error.text : '';
      }
    } else {
      const result = await generateText(callOptions);
      content = result.text;
      applyUsage(result.usage);
    }

    const usage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    };

    if (options.persistInvocationLog !== false) {
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
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        requestSummary: {
          messageCount: options.messages.length,
          ...(options.requestSummaryExtra ?? {}),
        },
        responseSummary: {
          replyLength: typeof content === 'string' ? content.length : (JSON.stringify(content)?.length ?? 0),
        },
      }).catch((error) => aiLogger.warn({ err: error }, 'invocation log failed'));
    }

    return {
      content: content as TSchema extends ZodTypeAny ? z.infer<TSchema> : string,
      model: { rowId: resolved.modelRowId, label: resolved.label, modelId: resolved.modelId },
      usage,
    };
  } catch (error) {
    aiLogger.error({ err: error }, 'invokeAi failed');
    // Failures used to be dropped here, so the admin log only ever showed
    // successes and the failure rate/latency were unobservable.
    if (options.persistInvocationLog !== false) {
      await recordInvocation({
        status: 'failure',
        errorCode: error instanceof AppError ? error.code : ERROR_CODES.INTERNAL_SERVER_ERROR,
        purpose,
        source: options.source,
        userId: options.userId,
        refType: options.ref?.type,
        refId: options.ref?.id,
        modelRowId: resolved?.modelRowId ?? null,
        providerId: resolved?.providerId ?? null,
        modelId: resolved?.modelId ?? null,
        baseUrl: resolved?.baseUrl ?? null,
        latencyMs: Date.now() - started,
        requestSummary: {
          messageCount: options.messages.length,
          ...(options.requestSummaryExtra ?? {}),
        },
      }).catch((logError) => aiLogger.warn({ err: logError }, 'invocation log failed'));
    }
    if (error instanceof AppError) throw error;
    throw new AppError(HTTP_STATUS.BAD_GATEWAY, ERROR_CODES.INTERNAL_SERVER_ERROR);
  }
}

export async function* streamAi(options: AiStreamOptions): AsyncGenerator<AiStreamEvent> {
  const started = Date.now();
  let resolved: ResolvedLlm | undefined;
  const purpose = options.purpose ?? (options.modelRowId ? null : 'assist');

  try {
    const modelRowId = await resolveModelRowId({
      modelRowId: options.modelRowId,
      purpose: purpose ?? undefined,
      userId: options.userId,
      providerScope: options.providerScope,
    });
    resolved = await resolveLlmByModelRowId(modelRowId);
    const model = createLlmClient(resolved, {
      timeoutMs: options.timeoutMs,
      maxTokens: options.maxTokens,
      enableThinking: options.enableThinking,
    });

    const tools = toAiSdkTools(options.tools);
    const prompt = toAiSdkPrompt(options.messages);
    const abortSignal =
      options.timeoutMs !== undefined
        ? options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)])
          : AbortSignal.timeout(options.timeoutMs)
        : options.signal;
    const result = streamText({
      model,
      ...prompt,
      abortSignal,
      // Same bound `invokeAi` applies: an unbounded stream ignores the model's
      // configured output cap and can run far past the caller's budget.
      maxOutputTokens: options.maxTokens ?? resolved.maxTokens ?? undefined,
      ...(tools
        ? {
            tools,
            stopWhen: stepCountIs(options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS),
          }
        : {}),
    });

    let content = '';
    for await (const delta of result.textStream) {
      content += delta;
      yield { type: 'delta', text: delta };
    }

    const finalUsage = await result.usage;
    const usage = {
      inputTokens: finalUsage.inputTokens ?? 0,
      outputTokens: finalUsage.outputTokens ?? 0,
      totalTokens: (finalUsage.inputTokens ?? 0) + (finalUsage.outputTokens ?? 0),
    };

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
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      requestSummary: {
        messageCount: options.messages.length,
        ...(options.requestSummaryExtra ?? {}),
      },
      responseSummary: { replyLength: content.length },
    }).catch((error) => aiLogger.warn({ err: error }, 'invocation log failed'));

    yield {
      type: 'done',
      content,
      model: { rowId: resolved.modelRowId, label: resolved.label, modelId: resolved.modelId },
      usage,
    };
  } catch (error) {
    aiLogger.error({ err: error }, 'streamAi failed');
    if (error instanceof AppError) throw error;
    throw new AppError(HTTP_STATUS.BAD_GATEWAY, ERROR_CODES.INTERNAL_SERVER_ERROR);
  }
}
