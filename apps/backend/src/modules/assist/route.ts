import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import { ASSIST_SSE_EVENT } from '@gloaming/shared/assist';

import { formatThrownError } from '@/lib/response';
import { type AuthVariables, requireAuth } from '@/middleware/auth';
import * as assistService from '@/modules/assist/service';
import { validateAssistAsk } from '@/modules/assist/validator';

export const assistRoutes = new Hono<{ Variables: AuthVariables }>();

assistRoutes.post('/api/assist/ask', requireAuth, validateAssistAsk, async (c) => {
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
      for await (const event of assistService.streamAssistAsk(user!.id, body, { signal: abort.signal })) {
        if (abort.signal.aborted) {
          return;
        }
        if (event.type === 'delta') {
          await stream.writeSSE({
            event: ASSIST_SSE_EVENT.delta,
            data: JSON.stringify({ text: event.text }),
          });
          continue;
        }
        await stream.writeSSE({
          event: ASSIST_SSE_EVENT.done,
          data: JSON.stringify({
            reply: event.content,
            model: { label: event.model.label },
            ...(event.suggestions?.length ? { suggestions: event.suggestions } : {}),
            ...(event.conversationId ? { conversationId: event.conversationId } : {}),
          }),
        });
      }
    } catch (error) {
      if (abort.signal.aborted) {
        return;
      }
      await stream.writeSSE({
        event: ASSIST_SSE_EVENT.error,
        data: JSON.stringify(formatThrownError(c, error)),
      });
    }
  });
});
