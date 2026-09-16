import { Hono } from 'hono';

import { HTTP_STATUS } from '@/constants';
import type { ObjectRange } from '@/lib/oss';
import type { AuthVariables } from '@/middleware/auth';
import {
  isAssetAuthorized,
  isPublicAsset,
  resolveAsset,
  resolveAssetViewer,
  streamAsset,
} from '@/modules/assets/service';

export const assetsRoutes = new Hono<{ Variables: AuthVariables }>();

/** Parse a `bytes=start-end` Range header — unsupported ranges are ignored (full body). */
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
  return { start, end };
}

/**
 * Unified resource gateway — the only entry for object-storage reads.
 * Authorization: admin may read anything; published work assets (image /
 * cover / audio) are public; draft/processing/failed + origin_file are admin-only.
 */
assetsRoutes.get('/api/assets/:assetId', async (c) => {
  const assetId = c.req.param('assetId');
  const asset = await resolveAsset(assetId);
  if (!asset) {
    return c.body(null, HTTP_STATUS.NOT_FOUND);
  }

  const viewer = resolveAssetViewer(c.get('user'));
  if (!isAssetAuthorized(viewer, asset)) {
    return c.body(null, HTTP_STATUS.FORBIDDEN);
  }

  const range = parseRangeHeader(c.req.header('range'));
  const object = await streamAsset(asset, range);
  if (!object) {
    return c.body(null, HTTP_STATUS.NOT_FOUND);
  }

  const headers = new Headers();
  headers.set('Content-Type', object.contentType);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', isPublicAsset(asset) ? 'public, max-age=31536000, immutable' : 'private, no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  if (object.etag) {
    headers.set('ETag', object.etag);
  }
  if (object.contentLength != null) {
    headers.set('Content-Length', String(object.contentLength));
  }
  if (object.contentRange) {
    headers.set('Content-Range', object.contentRange);
  }

  const status = object.contentRange ? HTTP_STATUS.PARTIAL_CONTENT : HTTP_STATUS.OK;
  return new Response(object.stream as unknown as BodyInit, { status, headers });
});
