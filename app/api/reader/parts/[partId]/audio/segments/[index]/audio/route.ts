import { z } from 'zod';

import { ttsVoiceRoleValues } from '@/shared/tts';

import { streamReaderAudioSegment } from '@/server/domains/reader-audio/service';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import type { ObjectRange } from '@/server/infra/storage';
import { RangeNotSatisfiableError } from '@/server/infra/storage';
import { jsonValidationError, jsonSchemaError } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { requireIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';
import { withApiError } from '@/server/infra/http/next-route';

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

export const GET = withApiError(async (request: Request, context: Ctx) => {
  const params = await context.params;
  const partId = pathId(params.partId, 'partId');
  const indexParam = params.index;
  const identity = await requireIdentity(request);
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
    return jsonSchemaError(request, queryParsed.error, 'query');
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
});
