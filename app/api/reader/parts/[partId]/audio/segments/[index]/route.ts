import { z } from 'zod';

import { readerAudioSegmentQuerySchema } from '@/shared/reader';

import { getReaderAudioSegment, peekReadyReaderAudioSegment } from '@/server/domains/reader-audio/service';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { jsonFromThrown, jsonOk, jsonValidationError, jsonSchemaError } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { acquireAiRateLimit } from '@/server/infra/http/next-rate-limit';
import { getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

const segmentIndexSchema = z.coerce.number().int().min(0);

type Ctx = { params: Promise<{ partId: string; index: string }> };

export async function GET(request: Request, context: Ctx) {
  let lease: { release: () => Promise<void> } | undefined;
  try {
    const params = await context.params;
    const partId = pathId(params.partId, 'partId');
    const indexParam = params.index;
    const identity = await getRequestIdentity(request);
    const url = new URL(request.url);

    const indexParsed = segmentIndexSchema.safeParse(indexParam);
    if (!indexParsed.success) {
      return jsonValidationError(request, [{ path: 'index', message: indexParsed.error.message }]);
    }

    const queryParsed = readerAudioSegmentQuerySchema.safeParse({
      role: url.searchParams.get('role') ?? undefined,
      expectedHash: url.searchParams.get('expectedHash') || undefined,
    });
    if (!queryParsed.success) {
      return jsonSchemaError(request, queryParsed.error, 'query');
    }

    const actor = workReadActorFromIdentity(identity.user);
    const ready = await peekReadyReaderAudioSegment(
      actor,
      partId,
      queryParsed.data.role,
      indexParsed.data,
      queryParsed.data.expectedHash,
    );
    if (ready) {
      // Cache hits must not consume synthesis quota — only paid Azure calls do.
      return jsonOk(ready);
    }

    // The only on-demand synthesis entry point (a paid Azure call), so this is
    // where the budget applies. Serving already-synthesized bytes goes through
    // the separate `/audio` route and is deliberately unthrottled — a reader
    // streaming a chapter must never be rate-limited on cache hits.
    const limited = await acquireAiRateLimit(request, 'ttsSynthesis', identity.user?.id ?? null);
    if (!limited.ok) {
      return limited.response;
    }
    lease = limited.lease;

    const segment = await getReaderAudioSegment(
      actor,
      partId,
      queryParsed.data.role,
      indexParsed.data,
      queryParsed.data.expectedHash,
    );
    return jsonOk(segment);
  } catch (error) {
    return jsonFromThrown(request, error);
  } finally {
    await lease?.release();
  }
}
