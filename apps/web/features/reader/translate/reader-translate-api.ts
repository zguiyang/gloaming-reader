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
} from '@gloaming/shared/translate';

import { ApiRequestError } from '@/lib/api-request';

export type TranslateStreamHandlers = {
  onMeta?: (meta: TranslateSseMeta) => void;
  onTitle?: (title: TranslateSseTitle) => void;
  onSentence?: (sentence: TranslateSseSentence) => void;
  onDone?: (done: TranslateSseDone) => void;
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

export async function streamTranslatePart(
  body: TranslatePartBody,
  handlers: TranslateStreamHandlers = {},
): Promise<TranslateSseDone> {
  const response = await fetch('/api/translate/part', {
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
    let message = '请求翻译失败';
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
    if (chunk.event === TRANSLATE_SSE_EVENT.meta) {
      const parsed = translateSseMetaSchema.safeParse(JSON.parse(chunk.data));
      if (parsed.success) {
        handlers.onMeta?.(parsed.data);
      }
      continue;
    }
    if (chunk.event === TRANSLATE_SSE_EVENT.title) {
      const parsed = translateSseTitleSchema.safeParse(JSON.parse(chunk.data));
      if (parsed.success) {
        handlers.onTitle?.(parsed.data);
      }
      continue;
    }
    if (chunk.event === TRANSLATE_SSE_EVENT.sentence) {
      const parsed = translateSseSentenceSchema.safeParse(JSON.parse(chunk.data));
      if (parsed.success) {
        handlers.onSentence?.(parsed.data);
      }
      continue;
    }
    if (chunk.event === TRANSLATE_SSE_EVENT.error) {
      const parsed = translateSseErrorSchema.safeParse(JSON.parse(chunk.data));
      throw new Error(parsed.success ? parsed.data.error : 'AI unavailable');
    }
    if (chunk.event === TRANSLATE_SSE_EVENT.done) {
      const parsed = translateSseDoneSchema.safeParse(JSON.parse(chunk.data));
      if (!parsed.success) {
        throw new Error('响应格式无效');
      }
      handlers.onDone?.(parsed.data);
      return parsed.data;
    }
  }

  throw new Error('AI unavailable');
}
