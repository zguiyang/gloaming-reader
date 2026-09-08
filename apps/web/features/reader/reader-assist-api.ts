import {
  ASSIST_SSE_EVENT,
  type AssistAskBody,
  assistSseDeltaSchema,
  assistSseDoneSchema,
  assistSseErrorSchema,
} from '@gloaming/shared/assist';

import { ApiRequestError } from '@/lib/api-request';

export type AssistStreamHandlers = {
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
};

async function* readSse(response: Response): AsyncGenerator<{ event: string; data: string }> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done: isStreamDone, value } = await reader.read();
    if (isStreamDone) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      let event = 'message';
      let data = '';
      for (const line of part.split('\n')) {
        if (line.startsWith('event:')) {
          event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          data += line.slice(5).trim();
        }
      }
      if (data) {
        yield { event, data };
      }
    }
  }
}

export async function streamAssistAsk(body: AssistAskBody, handlers: AssistStreamHandlers = {}) {
  const response = await fetch('/api/assist/ask', {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: handlers.signal,
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new ApiRequestError({ message: '未登录或登录已过期，请重新登录', status: 401 });
    }
    let message = '请求失败';
    try {
      const json = (await response.json()) as { error?: string };
      if (json.error?.trim()) {
        message = json.error.trim();
      }
    } catch {
      // keep default
    }
    throw new Error(message);
  }

  for await (const chunk of readSse(response)) {
    if (chunk.event === ASSIST_SSE_EVENT.delta) {
      const parsed = assistSseDeltaSchema.safeParse(JSON.parse(chunk.data));
      if (parsed.success) {
        handlers.onDelta?.(parsed.data.text);
      }
      continue;
    }
    if (chunk.event === ASSIST_SSE_EVENT.error) {
      const parsed = assistSseErrorSchema.safeParse(JSON.parse(chunk.data));
      throw new Error(parsed.success ? parsed.data.error : 'AI unavailable');
    }
    if (chunk.event === ASSIST_SSE_EVENT.done) {
      const parsed = assistSseDoneSchema.safeParse(JSON.parse(chunk.data));
      if (!parsed.success) {
        throw new Error('响应格式无效');
      }
      return parsed.data;
    }
  }

  throw new Error('AI unavailable');
}
