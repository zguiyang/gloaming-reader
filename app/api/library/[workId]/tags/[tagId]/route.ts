import { assignUserTag, unassignUserTag } from '@/server/domains/library/tags/service';

import { pathId } from '@/server/infra/http/path-params';
import { requireIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ workId: string; tagId: string }> };

export const PUT = withApiError(async (request: Request, context: Ctx) => {
  const identity = await requireIdentity(request);
  const params = await context.params;
  const workId = pathId(params.workId, 'workId');
  const tagId = pathId(params.tagId, 'tagId');
  await assignUserTag(identity.user.id, workId, tagId);
  return new Response(null, { status: HTTP_STATUS.NO_CONTENT });
});

export const DELETE = withApiError(async (request: Request, context: Ctx) => {
  const identity = await requireIdentity(request);
  const params = await context.params;
  const workId = pathId(params.workId, 'workId');
  const tagId = pathId(params.tagId, 'tagId');
  await unassignUserTag(identity.user.id, workId, tagId);
  return new Response(null, { status: HTTP_STATUS.NO_CONTENT });
});
