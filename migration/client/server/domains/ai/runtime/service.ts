import { generateText, streamText } from 'ai';
import type { z, ZodTypeAny } from 'zod';

import { recordInvocation } from '@/server/domains/ai/invocations/log';
import { resolveModelRowId } from '@/server/domains/ai/runtime/purpose-model';
import type {
  AiInvokeOptions,
  AiInvokeResult,
  AiStreamEvent,
  AiStreamOptions,
} from '@/server/domains/ai/runtime/types';
import { createLlmClient, type ResolvedLlm, resolveLlmByModelRowId } from '@/server/infra/llm';
import { rootLogger } from '@/server/infra/logging/logger';
import { HTTP_STATUS } from '@/server/shared/constants';
import { AppError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';

const aiLogger = rootLogger.child({ module: 'Ai' });

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

    const result = await generateText({
      model,
      messages: options.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      maxOutputTokens: options.maxTokens ?? resolved.maxTokens ?? undefined,
    });

    const usage = {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      totalTokens: (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0),
    };

    let content: unknown = result.text;
    if (options.outputSchema) {
      content = options.outputSchema.parse(JSON.parse(result.text));
    }

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
        responseSummary: { replyLength: String(content).length },
      }).catch((error) => aiLogger.warn({ err: error }, 'invocation log failed'));
    }

    return {
      content: content as TSchema extends ZodTypeAny ? z.infer<TSchema> : string,
      model: { rowId: resolved.modelRowId, label: resolved.label, modelId: resolved.modelId },
      usage,
    };
  } catch (error) {
    aiLogger.error({ err: error }, 'invokeAi failed');
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
    });
    resolved = await resolveLlmByModelRowId(modelRowId);
    const model = createLlmClient(resolved, {
      timeoutMs: options.timeoutMs,
      enableThinking: options.enableThinking,
    });

    const result = streamText({
      model,
      messages: options.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      abortSignal: options.signal,
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
