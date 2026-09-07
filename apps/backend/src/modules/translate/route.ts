import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import { TRANSLATE_SSE_EVENT } from '@gloaming/shared/translate';

import { AppError, NotFoundError } from '@/lib/errors';
import { type AuthVariables, requireAuth } from '@/middleware/auth';
import * as translateService from '@/modules/translate/service';
import { validateTranslatePart } from '@/modules/translate/validator';

export const translateRoutes = new Hono<{ Variables: AuthVariables }>();

translateRoutes.post('/api/translate/part', requireAuth, validateTranslatePart, async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  c.header('X-Accel-Buffering', 'no');
  c.header('Cache-Control', 'no-cache, no-transform');

  return streamSSE(c, async (stream) => {
    const abort = new AbortController();
    stream.onAbort(() => {
      abort.abort();
    });

    try {
      for await (const event of translateService.streamTranslatePart(user!.id, body, { signal: abort.signal })) {
        if (abort.signal.aborted) {
          return;
        }
        if (event.type === 'meta') {
          await stream.writeSSE({
            event: TRANSLATE_SSE_EVENT.meta,
            data: JSON.stringify({
              contentHash: event.contentHash,
              titleEn: event.titleEn,
              sentences: event.sentences,
            }),
          });
          continue;
        }
        if (event.type === 'title') {
          await stream.writeSSE({
            event: TRANSLATE_SSE_EVENT.title,
            data: JSON.stringify({ zh: event.zh }),
          });
          continue;
        }
        if (event.type === 'sentence') {
          await stream.writeSSE({
            event: TRANSLATE_SSE_EVENT.sentence,
            data: JSON.stringify({ index: event.index, zh: event.zh }),
          });
          continue;
        }
        await stream.writeSSE({
          event: TRANSLATE_SSE_EVENT.done,
          data: JSON.stringify({
            contentHash: event.contentHash,
            cached: event.cached,
          }),
        });
      }
    } catch (error) {
      if (abort.signal.aborted) {
        return;
      }
      const message =
        error instanceof NotFoundError
          ? error.message
          : error instanceof AppError
            ? error.message
            : error instanceof Error && /model not configured/i.test(error.message)
              ? error.message
              : error instanceof Error && /Missing translation/i.test(error.message)
                ? 'AI unavailable'
                : 'AI unavailable';
      await stream.writeSSE({
        event: TRANSLATE_SSE_EVENT.error,
        data: JSON.stringify({ error: message }),
      });
    }
  });
});
