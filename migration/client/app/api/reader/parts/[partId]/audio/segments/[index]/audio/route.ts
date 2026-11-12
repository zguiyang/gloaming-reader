import { z } from 'zod';

import { ttsVoiceRoleValues } from '@gloaming/shared/tts';

import { streamReaderAudioSegment } from '@/server/domains/reader-audio/service';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import type { ObjectRange } from '@/server/infra/storage';
import { RangeNotSatisfiableError } from '@/server/infra/storage';
import { jsonFromThrown, jsonValidationError } from '@/server/infra/http/next-json';
import { getRequestIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';

export const dynamic = 'force-dynamic';

const segmentIndexSchema = z.coerce.number().int().min(0);

const segmentStreamQuerySchema = z.object({
  role: z.enum(ttsVoiceRoleValues),
  hash: z.string().min(16).max(128),
});

type Ctx = { params: Promise<{ partId: string; index: string }> };

function parseRangeHeader(header: string | undefined): ObjectRange | undefined {
  if (!header) {
    return undefined;
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if (!match) {
    return undefined;
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : undefined;
  if (!Number.isFinite(start) || start < 0) {
    return undefined;
  }
  if (end !== undefined && (!Number.isFinite(end) || end < start)) {
    return undefined;
  }
  return { start, end };
}

export async function GET(request: Request, context: Ctx) {
  try {
    const { partId, index: indexParam } = await context.params;
    const identity = await getRequestIdentity(request);
    const url = new URL(request.url);

    const indexParsed = segmentIndexSchema.safeParse(indexParam);
    if (!indexParsed.success) {
      return jsonValidationError(request, [{ path: 'index', message: indexParsed.error.message }]);
    }

    const queryParsed = segmentStreamQuerySchema.safeParse({
      role: url.searchParams.get('role'),
      hash: url.searchParams.get('hash'),
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
    const range = parseRangeHeader(request.headers.get('range') ?? undefined);

    let result;
    try {
      result = await streamReaderAudioSegment(
        actor,
        partId,
        queryParsed.data.role,
        indexParsed.data,
        queryParsed.data.hash,
        range,
      );
    } catch (error) {
      if (error instanceof RangeNotSatisfiableError) {
        const headers = new Headers();
        headers.set('Accept-Ranges', 'bytes');
        if (error.objectSize != null) {
          headers.set('Content-Range', `bytes */${error.objectSize}`);
        }
        return new Response(null, { status: HTTP_STATUS.RANGE_NOT_SATISFIABLE, headers });
      }
      throw error;
    }

    const headers = new Headers();
    headers.set('Content-Type', result.contentType);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'private, no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    if (result.etag) {
      headers.set('ETag', result.etag);
    }
    if (result.contentLength != null) {
      headers.set('Content-Length', String(result.contentLength));
    }
    if (result.contentRange) {
      headers.set('Content-Range', result.contentRange);
    }

    const status = result.contentRange ? HTTP_STATUS.PARTIAL_CONTENT : HTTP_STATUS.OK;
    return new Response(result.stream as unknown as BodyInit, { status, headers });
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
