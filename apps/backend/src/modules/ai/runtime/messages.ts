import type { UsageMetadata } from '@langchain/core/messages';
import { AIMessage, type BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';

import type { AiMessageInput, TokenBucket } from '@/modules/ai/runtime/types';

export function emptyTokens(): TokenBucket {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

export function addUsage(bucket: TokenBucket, usage?: UsageMetadata | null): void {
  if (!usage) {
    return;
  }
  bucket.inputTokens += usage.input_tokens ?? 0;
  bucket.outputTokens += usage.output_tokens ?? 0;
  const total = usage.total_tokens ?? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
  bucket.totalTokens += total;
}

export function toBaseMessages(messages: AiMessageInput[]): BaseMessage[] {
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

export function messageContentToString(content: unknown): string {
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

export function replyTextFromContent(content: unknown): string {
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
