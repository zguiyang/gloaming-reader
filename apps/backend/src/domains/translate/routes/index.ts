import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import { TRANSLATE_SSE_EVENT } from '@gloaming/shared/translate';

import * as translateService from '@/domains/translate/service';
import { validateTranslatePart } from '@/domains/translate/validator';
import { workReadActorFromIdentity } from '@/domains/works/access';
import { type AuthVariables, requireAuth } from '@/infra/http/middleware/auth';
import { aiRateLimit } from '@/infra/http/middleware/rate-limit';
import { formatThrownError } from '@/infra/http/response';

export const translateRoutes = new Hono<{ Variables: AuthVariables }>();

translateRoutes.post('/api/translate/part', requireAuth, validateTranslatePart, aiRateLimit('translate'), async (c) => {
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
      const actor = workReadActorFromIdentity(user);
      for await (const event of translateService.streamTranslatePart(actor, user!.id, body, { signal: abort.signal })) {
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
      await stream.writeSSE({
        event: TRANSLATE_SSE_EVENT.error,
        data: JSON.stringify(formatThrownError(c, error)),
      });
    }
  });
});
