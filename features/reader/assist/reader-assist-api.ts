import {
  ASSIST_SSE_EVENT,
  type AssistAskBody,
  assistSseDeltaSchema,
  assistSseDoneSchema,
  assistSseErrorSchema,
} from '@/shared/assist';

import { parseSseEvent, postSse, readSse, sseMessage, throwSseHttpError } from '@/lib/sse';

export type AssistStreamHandlers = {
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
};

export async function streamAssistAsk(body: AssistAskBody, handlers: AssistStreamHandlers = {}) {
  const response = await postSse('/api/assist/ask', body, handlers.signal);

  if (!response.ok) {
    await throwSseHttpError(response, 'content.reader.api.requestFailed');
  }

  for await (const chunk of readSse(response, 'content.reader.api.noResponseBody')) {
    if (chunk.event === ASSIST_SSE_EVENT.delta) {
      const parsed = parseSseEvent(chunk.data, assistSseDeltaSchema);
      if (parsed) {
        handlers.onDelta?.(parsed.text);
      }
      continue;
    }
    if (chunk.event === ASSIST_SSE_EVENT.error) {
      const parsed = parseSseEvent(chunk.data, assistSseErrorSchema);
      throw new Error(parsed ? parsed.error : sseMessage('content.reader.api.aiUnavailable'));
    }
    if (chunk.event === ASSIST_SSE_EVENT.done) {
      const parsed = parseSseEvent(chunk.data, assistSseDoneSchema);
      if (!parsed) {
        throw new Error(sseMessage('content.reader.api.invalidResponse'));
      }
      return parsed;
    }
  }

  throw new Error(sseMessage('content.reader.api.aiUnavailable'));
}
