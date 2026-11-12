import { ASSIST_SSE_EVENT, assistAskBodySchema } from '@gloaming/shared/assist';

import { streamAssistAsk } from '@/server/domains/assist/service';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { jsonFromThrown, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';
import { encodeSseMessage, formatThrownErrorBody, sseResponseHeaders } from '@/server/infra/http/next-sse';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);

    const raw = await request.json().catch(() => null);
    const parsed = assistAskBodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }

    const body = parsed.data;
    const userId = identity.user.id;
    const actor = workReadActorFromIdentity(identity.user);

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const abort = new AbortController();
        request.signal.addEventListener('abort', () => abort.abort(), { once: true });

        const write = (event: string, data: string) => {
          if (abort.signal.aborted) {
            return;
          }
          controller.enqueue(encoder.encode(encodeSseMessage(event, data)));
        };

        try {
          for await (const event of streamAssistAsk(actor, userId, body, { signal: abort.signal })) {
            if (abort.signal.aborted) {
              break;
            }
            if (event.type === 'delta') {
              write(ASSIST_SSE_EVENT.delta, JSON.stringify({ text: event.text }));
              continue;
            }
            write(
              ASSIST_SSE_EVENT.done,
              JSON.stringify({
                reply: event.content,
                model: { label: event.model.label },
                ...(event.suggestions?.length ? { suggestions: event.suggestions } : {}),
                ...(event.conversationId ? { conversationId: event.conversationId } : {}),
              }),
            );
          }
        } catch (error) {
          if (!abort.signal.aborted) {
            write(ASSIST_SSE_EVENT.error, JSON.stringify(formatThrownErrorBody(request, error)));
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, { headers: sseResponseHeaders() });
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
