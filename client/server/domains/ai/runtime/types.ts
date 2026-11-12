import type { ZodTypeAny } from 'zod';

import type { AiPurpose } from '@/server/domains/ai/purposes';

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

/** Tool handle for Vercel AI SDK — domains supply Zod schemas + execute. */
export type AiToolHandle = {
  name: string;
  description?: string;
  inputSchema: ZodTypeAny;
  execute: (input: unknown) => Promise<unknown>;
};

export type AiInvokeOptions<TSchema extends ZodTypeAny | undefined = undefined> = {
  purpose?: AiPurpose;
  modelRowId?: string;
  source: string;
  userId?: string;
  ref?: AiInvokeRef;
  messages: AiMessageInput[];
  tools?: AiToolHandle[];
  outputSchema?: TSchema;
  maxToolRounds?: number;
  timeoutMs?: number;
  enableThinking?: boolean;
  providerScope?: 'user-first' | 'user-only';
  maxTokens?: number;
  maxRetries?: number;
  jsonObject?: boolean;
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
  tools?: AiToolHandle[];
  maxToolRounds?: number;
  timeoutMs?: number;
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
