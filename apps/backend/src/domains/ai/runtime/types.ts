import type { StructuredToolInterface } from '@langchain/core/tools';
import type { ZodTypeAny } from 'zod';

import type { AiPurpose } from '@/domains/ai/purposes';

export type AiMessageInput = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type AiInvokeRef = {
  type: string;
  id: string;
};

export type AiInvocationSummaryExtra = {
  actionId?: string;
  phase?: string;
  workId?: string;
  neededFields?: string;
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
  /** Require a user-owned provider and never fall back to an instance provider. */
  providerScope?: 'user-first' | 'user-only';
  /** Per-invocation token cap, used by bounded background jobs. */
  maxTokens?: number;
  /** Provider-internal retries; background jobs may set zero to keep retry accounting at the queue. */
  maxRetries?: number;
  /** Skip the invocation-log database write for isolated diagnostic calls. */
  persistInvocationLog?: boolean;
  requestSummaryExtra?: AiInvocationSummaryExtra;
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
  requestSummaryExtra?: AiInvocationSummaryExtra;
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

export type TokenBucket = { inputTokens: number; outputTokens: number; totalTokens: number };
