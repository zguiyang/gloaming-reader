import { isAssetAuthorized, isPublicAsset, resolveAsset, streamAsset } from '@/server/domains/assets/gateway/service';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { jsonFromThrown } from '@/server/infra/http/next-json';
import { getRequestIdentity } from '@/server/infra/http/next-session';
import type { ObjectRange } from '@/server/infra/storage';
import { HTTP_STATUS } from '@/server/shared/constants';

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

export async function GET(request: Request, context: Ctx) {
  try {
    const { assetId } = await context.params;
    const asset = await resolveAsset(assetId);
    if (!asset) {
      return new Response(null, { status: HTTP_STATUS.NOT_FOUND });
    }

    const identity = await getRequestIdentity(request);
    const actor = workReadActorFromIdentity(identity.user);
    if (!(await isAssetAuthorized(actor, asset))) {
      return new Response(null, { status: HTTP_STATUS.FORBIDDEN });
    }

    const range = parseRangeHeader(request.headers.get('range'));
    const object = await streamAsset(asset, range);
    if (!object) {
      return new Response(null, { status: HTTP_STATUS.NOT_FOUND });
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
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
