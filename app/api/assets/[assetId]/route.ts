import { isAssetAuthorized, isPublicAsset, resolveAsset, streamAsset } from '@/server/domains/assets/gateway/service';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { jsonError } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { requireIdentity } from '@/server/infra/http/next-session';
import type { ObjectRange } from '@/server/infra/storage';
import { HTTP_STATUS } from '@/server/shared/constants';
import { ERROR_CODES } from '@/server/shared/errors/codes';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

function parseRangeHeader(header: string | null): ObjectRange | undefined {
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

type Ctx = { params: Promise<{ assetId: string }> };

/** Identical body and status for "no such asset" and "not yours" (no enumeration oracle). */
function assetNotFound(request: Request): Response {
  return jsonError(request, ERROR_CODES.NOT_FOUND.ASSET, HTTP_STATUS.NOT_FOUND);
}

export const GET = withApiError(async (request: Request, context: Ctx) => {
  const assetId = pathId((await context.params).assetId, 'assetId');
  const asset = await resolveAsset(assetId);

  const identity = await requireIdentity(request);
  const actor = workReadActorFromIdentity(identity.user);
  // Authorization runs for every id, and every failure — unknown row, unreadable
  // Work, or missing object — returns the same 404. A 403 on existing rows would
  // let a caller tell real asset ids apart from invented ones.
  if (!asset || !(await isAssetAuthorized(actor, asset))) {
    return assetNotFound(request);
  }

  const range = parseRangeHeader(request.headers.get('range'));
  const object = await streamAsset(asset, range);
  if (!object) {
    return assetNotFound(request);
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
