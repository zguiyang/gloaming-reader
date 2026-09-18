import type { AIMessageChunk, BaseMessage, UsageMetadata } from '@langchain/core/messages';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { eq } from 'drizzle-orm';
import type { z, ZodTypeAny } from 'zod';

import { llmAppSetting as llmAppSettingTable } from '@gloaming/db';

import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { AppError } from '@/lib/errors/app-error';
import { ERROR_CODES } from '@/lib/errors/codes';
import { createLlmClient, type ResolvedLlm, resolveLlmByModelRowId } from '@/lib/llm';
import { rootLogger } from '@/lib/logger';
import { recordInvocation, truncatePreview } from '@/modules/ai/log';
import { type AiPurpose, settingKeyForPurpose } from '@/modules/ai/purposes';

const aiLogger = rootLogger.child({ module: 'Ai' });
const DEFAULT_MAX_TOOL_ROUNDS = 3;

export type AiMessageInput = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type AiInvokeRef = {
  type: string;
  id: string;
};

export type AiInvokeOptions<TSchema extends ZodTypeAny | undefined = undefined> = {
  purpose?: AiPurpose;
  /** Explicit model row (admin test / future pin). Overrides purpose when set. */
  modelRowId?: string;
  source: string;
  userId?: string;
  ref?: AiInvokeRef;
  messages: AiMessageInput[];
  tools?: StructuredToolInterface[];
  outputSchema?: TSchema;
  maxToolRounds?: number;
  timeoutMs?: number;
  /** Thinking mode toggle; off by default. Only forwarded when the provider declares a thinking param. */
  enableThinking?: boolean;
  requestSummaryExtra?: Record<string, unknown>;
};

export type AiInvokeResult<T = string> = {
  content: T;
  model: { rowId: string; label: string; modelId: string };
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
};

export type AiStreamOptions = {
  purpose?: AiPurpose;
  modelRowId?: string;
  source: string;
  userId?: string;
  ref?: AiInvokeRef;
  messages: AiMessageInput[];
  tools?: StructuredToolInterface[];
  maxToolRounds?: number;
  timeoutMs?: number;
  /** Thinking mode toggle; off by default. Only forwarded when the provider declares a thinking param. */
  enableThinking?: boolean;
  requestSummaryExtra?: Record<string, unknown>;
  signal?: AbortSignal;
};

export type AiStreamDeltaEvent = { type: 'delta'; text: string };
export type AiStreamDoneEvent = {
  type: 'done';
  content: string;
  model: { rowId: string; label: string; modelId: string };
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
};
export type AiStreamEvent = AiStreamDeltaEvent | AiStreamDoneEvent;

type TokenBucket = { inputTokens: number; outputTokens: number; totalTokens: number };

function emptyTokens(): TokenBucket {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

function addUsage(bucket: TokenBucket, usage?: UsageMetadata | null): void {
  if (!usage) {
    return;
  }
  bucket.inputTokens += usage.input_tokens ?? 0;
  bucket.outputTokens += usage.output_tokens ?? 0;
  const total = usage.total_tokens ?? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
  bucket.totalTokens += total;
}

function toBaseMessages(messages: AiMessageInput[]): BaseMessage[] {
  return messages.map((message) => {
    if (message.role === 'system') {
      return new SystemMessage(message.content);
    }
    if (message.role === 'assistant') {
      return new AIMessage(message.content);
    }
    return new HumanMessage(message.content);
  });
}

function messageContentToString(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      })
      .join('');
  }
  return content == null ? '' : String(content);
}

function replyTextFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (
    content &&
    typeof content === 'object' &&
    'reply' in content &&
    typeof (content as { reply: unknown }).reply === 'string'
  ) {
    return (content as { reply: string }).reply;
  }
  return JSON.stringify(content);
}

async function resolveModelRowId(options: { modelRowId?: string; purpose?: AiPurpose }): Promise<string> {
  if (options.modelRowId) {
    return options.modelRowId;
  }
  const purpose = options.purpose ?? 'assist';
  const key = settingKeyForPurpose(purpose);
  const rows = await db.select().from(llmAppSettingTable).where(eq(llmAppSettingTable.key, key)).limit(1);
  const value = rows[0]?.value;
  if (!value) {
    const label =
      purpose === 'assist'
        ? 'Assist'
        : purpose === 'translate'
          ? 'Translate'
          : purpose === 'metadata-enrich'
            ? 'Metadata enrich'
            : 'AI';
    throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.AI.MODEL_NOT_CONFIGURED, { label });
  }
  return value;
}

function buildRequestSummary(
  options: {
    messages: AiMessageInput[];
    tools?: StructuredToolInterface[];
    requestSummaryExtra?: Record<string, unknown>;
  },
  toolRoundCount: number,
) {
  const userText = options.messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n');
  return {
    messageCount: options.messages.length,
    selectionPreview: userText ? truncatePreview(userText) : undefined,
    selectionLength: userText.length || undefined,
    toolNames: options.tools?.map((t) => t.name),
    toolRoundCount,
    ...options.requestSummaryExtra,
  };
}

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
