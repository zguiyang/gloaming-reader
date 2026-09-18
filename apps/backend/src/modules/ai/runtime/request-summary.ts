import type { StructuredToolInterface } from '@langchain/core/tools';

import { truncatePreview } from '@/modules/ai/invocations/log';
import type { AiMessageInput } from '@/modules/ai/runtime/types';

export function buildRequestSummary(
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
