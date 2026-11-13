import type { z } from 'zod';

import { t } from '@/i18n';

import { ApiRequestError } from '@/lib/api-request';
import { getClientLocale } from '@/lib/client-locale';
import { applyRequestLocale } from '@/lib/request-language';

/** Localized message for an SSE transport failure. */
export function sseMessage(key: string): string {
  return t(getClientLocale(), key);
}

export type SseChunk = { event: string; data: string };

/** POST a streaming endpoint with the locale header and shared accept pair. */
export async function postSse(url: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: applyRequestLocale({
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify(body),
    signal,
  });
}

/**
 * Turn a failed streaming response into a thrown error.
 *
 * 401 is kept as an `ApiRequestError` so callers can distinguish "session
 * expired" from an upstream failure.
 */
export async function throwSseHttpError(response: Response, fallbackKey: string): Promise<never> {
  if (response.status === 401) {
    throw new ApiRequestError({ message: sseMessage('content.reader.api.unauthorized'), status: 401 });
  }
  let message = sseMessage(fallbackKey);
  try {
    const json = (await response.json()) as { error?: string };
    if (json.error?.trim()) {
      message = json.error.trim();
    }
  } catch {
    // Non-JSON error body: keep the localized fallback.
  }
  throw new Error(message);
}

/**
 * Parse one SSE frame stream.
 *
 * The reader is cancelled on every exit path — callers `return` as soon as a
 * terminal event arrives, and without the `finally` the connection stayed open
 * until the server stopped pushing.
 */
export async function* readSse(response: Response, missingBodyKey: string): AsyncGenerator<SseChunk> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error(sseMessage(missingBodyKey));
  }
  const decoder = new TextDecoder();
  let buffer = '';
  try {
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
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * Validate one SSE frame against its schema.
 *
 * Returns `null` for both malformed JSON and schema mismatch: a truncated or
 * non-JSON frame must not surface a raw `SyntaxError` in a user-facing toast.
 */
export function parseSseEvent<T>(data: string, schema: z.ZodType<T>): T | null {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
