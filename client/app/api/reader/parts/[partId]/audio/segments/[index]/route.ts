import { z } from 'zod';

import { readerAudioSegmentQuerySchema } from '@/shared/reader';

import { getReaderAudioSegment } from '@/server/domains/reader-audio/service';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

const segmentIndexSchema = z.coerce.number().int().min(0);

type Ctx = { params: Promise<{ partId: string; index: string }> };

export async function GET(request: Request, context: Ctx) {
  try {
    const { partId, index: indexParam } = await context.params;
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
      return jsonValidationError(
        request,
        queryParsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'query',
          message: issue.message,
        })),
      );
    }

    const actor = workReadActorFromIdentity(identity.user);
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
  }
}
