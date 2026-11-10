import type { StructuredToolInterface } from '@langchain/core/tools';

import type { AiInvocationRequestSummary } from '@gloaming/db';

import type { AiInvocationSummaryExtra, AiMessageInput } from '@/domains/ai/runtime/types';

export function buildRequestSummary(
  options: {
    messages: AiMessageInput[];
    tools?: StructuredToolInterface[];
    requestSummaryExtra?: AiInvocationSummaryExtra;
  },
  toolRoundCount: number,
): AiInvocationRequestSummary {
  const userMessages = options.messages.filter((message) => message.role === 'user');
  const selectionLength = userMessages.reduce((length, message, index) => length + message.content.length + index, 0);
  return {
    messageCount: options.messages.length,
    selectionLength: selectionLength || undefined,
    toolNames: options.tools?.map((t) => t.name),
    toolRoundCount,
    ...options.requestSummaryExtra,
  };
}
