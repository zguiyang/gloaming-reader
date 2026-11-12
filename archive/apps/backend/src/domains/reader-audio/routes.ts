import { Hono } from 'hono';
import { z } from 'zod';

import { readerAudioManifestQuerySchema, readerAudioSegmentQuerySchema } from '@gloaming/shared/reader';
import { ttsVoiceRoleValues } from '@gloaming/shared/tts';

import {
  getReaderAudioManifest,
  getReaderAudioSegment,
  streamReaderAudioSegment,
} from '@/domains/reader-audio/service';
import { workReadActorFromIdentity } from '@/domains/works/access';
import type { AuthVariables } from '@/infra/http/middleware/auth';
import type { ObjectRange } from '@/infra/storage';
import { RangeNotSatisfiableError } from '@/infra/storage';
import { HTTP_STATUS } from '@/shared/constants';

export const readerAudioRoutes = new Hono<{ Variables: AuthVariables }>();

const segmentIndexSchema = z.coerce.number().int().min(0);

const segmentStreamQuerySchema = z.object({
  role: z.enum(ttsVoiceRoleValues),
  hash: z.string().min(16).max(128),
});

/**
 * Parse a `bytes=start-end` Range header — unsupported ranges are ignored
 * (full body), including `end < start`, which RFC 9110 treats as unsatisfiable
 * but we degrade to a 200 for simplicity.
 */
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
    // Inverted or malformed bounds — ignore the header, serve the full body.
    return undefined;
  }
  return { start, end };
}

readerAudioRoutes.get('/api/reader/parts/:partId/audio/manifest', async (c) => {
  const query = readerAudioManifestQuerySchema.parse({ role: c.req.query('role') });
  const actor = workReadActorFromIdentity(c.get('user'));
  const manifest = await getReaderAudioManifest(actor, c.req.param('partId'), query.role);
  return c.json(manifest);
});

readerAudioRoutes.get('/api/reader/parts/:partId/audio/segments/:index', async (c) => {
  const query = readerAudioSegmentQuerySchema.parse({
    role: c.req.query('role'),
    expectedHash: c.req.query('expectedHash') || undefined,
  });
  const index = segmentIndexSchema.parse(c.req.param('index'));
  const actor = workReadActorFromIdentity(c.get('user'));
  const segment = await getReaderAudioSegment(actor, c.req.param('partId'), query.role, index, query.expectedHash);
  return c.json(segment);
});

readerAudioRoutes.get('/api/reader/parts/:partId/audio/segments/:index/audio', async (c) => {
  const query = segmentStreamQuerySchema.parse({ role: c.req.query('role'), hash: c.req.query('hash') });
  const index = segmentIndexSchema.parse(c.req.param('index'));
  const actor = workReadActorFromIdentity(c.get('user'));
  const range = parseRangeHeader(c.req.header('range'));

  let result;
  try {
    result = await streamReaderAudioSegment(actor, c.req.param('partId'), query.role, index, query.hash, range);
  } catch (error) {
    if (error instanceof RangeNotSatisfiableError) {
      // 416, never 500 — include `Content-Range: bytes */<size>` when known.
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
  // The resolved voice, provider scope, and access can change at the same URL.
  // The player already buffers bytes in memory; always recheck authorization here.
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
