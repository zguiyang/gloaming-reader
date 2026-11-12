import { TRANSLATE_SSE_EVENT, translatePartBodySchema } from '@gloaming/shared/translate';

import { streamTranslatePart } from '@/server/domains/translate/service';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { jsonFromThrown, jsonValidationError } from '@/server/infra/http/next-json';
import { acquireAiRateLimit, withAiRateLimitRelease } from '@/server/infra/http/next-rate-limit';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';
import { encodeSseMessage, formatThrownErrorBody, sseResponseHeaders } from '@/server/infra/http/next-sse';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let lease: { release: () => Promise<void> } | undefined;
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);

    const limited = await acquireAiRateLimit(request, 'translate', identity.user.id);
    if (!limited.ok) {
      return limited.response;
    }
    lease = limited.lease;

    const raw = await request.json().catch(() => null);
    const parsed = translatePartBodySchema.safeParse(raw);
    if (!parsed.success) {
      await lease.release();
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
          for await (const event of streamTranslatePart(actor, userId, body, { signal: abort.signal })) {
            if (abort.signal.aborted) {
              break;
            }
            if (event.type === 'meta') {
              write(
                TRANSLATE_SSE_EVENT.meta,
                JSON.stringify({
                  contentHash: event.contentHash,
                  titleEn: event.titleEn,
                  sentences: event.sentences,
                }),
              );
              continue;
            }
            if (event.type === 'title') {
              write(TRANSLATE_SSE_EVENT.title, JSON.stringify({ zh: event.zh }));
              continue;
            }
            if (event.type === 'sentence') {
              write(TRANSLATE_SSE_EVENT.sentence, JSON.stringify({ index: event.index, zh: event.zh }));
              continue;
            }
            write(
              TRANSLATE_SSE_EVENT.done,
              JSON.stringify({
                contentHash: event.contentHash,
                cached: event.cached,
              }),
            );
          }
        } catch (error) {
          if (!abort.signal.aborted) {
            write(TRANSLATE_SSE_EVENT.error, JSON.stringify(formatThrownErrorBody(request, error)));
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
