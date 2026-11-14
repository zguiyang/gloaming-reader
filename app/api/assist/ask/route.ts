import { ASSIST_SSE_EVENT, assistAskBodySchema } from '@/shared/assist';

import { streamAssistAsk } from '@/server/domains/assist/service';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { jsonFromThrown, parseJsonBody } from '@/server/infra/http/next-json';
import { acquireAiRateLimit, withAiRateLimitRelease } from '@/server/infra/http/next-rate-limit';
import { requireIdentity } from '@/server/infra/http/next-session';
import { encodeSseMessage, formatThrownErrorBody, sseResponseHeaders } from '@/server/infra/http/next-sse';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let lease: { release: () => Promise<void> } | undefined;
  try {
    const identity = await requireIdentity(request);

    // Validate before spending quota: `release()` only returns the concurrency
    // slot, so a malformed body used to burn a full user/IP point.
    const parsed = await parseJsonBody(request, assistAskBodySchema);
    if ('response' in parsed) return parsed.response;

    const limited = await acquireAiRateLimit(request, 'assist', identity.user.id);
    if (!limited.ok) {
      return limited.response;
    }
    lease = limited.lease;

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

    return withAiRateLimitRelease(new Response(stream, { headers: sseResponseHeaders() }), lease);
  } catch (error) {
    if (lease) {
      await lease.release();
    }
    return jsonFromThrown(request, error);
  }
}
