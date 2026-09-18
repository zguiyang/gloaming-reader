import type { StructuredToolInterface } from '@langchain/core/tools';
import type { ZodTypeAny } from 'zod';

import type { AiPurpose } from '@/modules/ai/purposes';

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

export type TokenBucket = { inputTokens: number; outputTokens: number; totalTokens: number };
