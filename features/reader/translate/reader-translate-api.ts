import {
  TRANSLATE_SSE_EVENT,
  type TranslatePartBody,
  type TranslateSseDone,
  translateSseDoneSchema,
  translateSseErrorSchema,
  type TranslateSseMeta,
  translateSseMetaSchema,
  type TranslateSseSentence,
  translateSseSentenceSchema,
  type TranslateSseTitle,
  translateSseTitleSchema,
} from '@/shared/translate';

import { parseSseEvent, postSse, readSse, sseMessage, throwSseHttpError } from '@/lib/sse';

export type TranslateStreamHandlers = {
  onMeta?: (meta: TranslateSseMeta) => void;
  onTitle?: (title: TranslateSseTitle) => void;
  onSentence?: (sentence: TranslateSseSentence) => void;
  onDone?: (done: TranslateSseDone) => void;
  signal?: AbortSignal;
};

export async function streamTranslatePart(
  body: TranslatePartBody,
  handlers: TranslateStreamHandlers = {},
): Promise<TranslateSseDone> {
  const response = await postSse('/api/translate/part', body, handlers.signal);

  if (!response.ok) {
    await throwSseHttpError(response, 'content.reader.api.translateFailed');
  }

  for await (const chunk of readSse(response, 'content.reader.translate.noResponseBody')) {
    if (chunk.event === TRANSLATE_SSE_EVENT.meta) {
      const parsed = parseSseEvent(chunk.data, translateSseMetaSchema);
      if (parsed) {
        handlers.onMeta?.(parsed);
      }
      continue;
    }
    if (chunk.event === TRANSLATE_SSE_EVENT.title) {
      const parsed = parseSseEvent(chunk.data, translateSseTitleSchema);
      if (parsed) {
        handlers.onTitle?.(parsed);
      }
      continue;
    }
    if (chunk.event === TRANSLATE_SSE_EVENT.sentence) {
      const parsed = parseSseEvent(chunk.data, translateSseSentenceSchema);
      if (parsed) {
        handlers.onSentence?.(parsed);
      }
      continue;
    }
    if (chunk.event === TRANSLATE_SSE_EVENT.error) {
      const parsed = parseSseEvent(chunk.data, translateSseErrorSchema);
      throw new Error(parsed ? parsed.error : sseMessage('content.reader.api.aiUnavailable'));
    }
    if (chunk.event === TRANSLATE_SSE_EVENT.done) {
      const parsed = parseSseEvent(chunk.data, translateSseDoneSchema);
      if (!parsed) {
        throw new Error(sseMessage('content.reader.api.invalidResponse'));
      }
      handlers.onDone?.(parsed);
      return parsed;
    }
  }

  throw new Error(sseMessage('content.reader.api.aiUnavailable'));
}
