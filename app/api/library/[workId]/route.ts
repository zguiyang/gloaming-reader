import { addToLibrary, removeFromLibrary } from '@/server/domains/library/service';

import { pathId } from '@/server/infra/http/path-params';
import { requireIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ workId: string }> };

export const POST = withApiError(async (request: Request, context: Ctx) => {
  const identity = await requireIdentity(request);
  const workId = pathId((await context.params).workId, 'workId');
  await addToLibrary(identity.user.id, workId);
  return new Response(null, { status: HTTP_STATUS.NO_CONTENT });
});

export const DELETE = withApiError(async (request: Request, context: Ctx) => {
  const identity = await requireIdentity(request);
  const workId = pathId((await context.params).workId, 'workId');
  await removeFromLibrary(identity.user.id, workId);
  return new Response(null, { status: HTTP_STATUS.NO_CONTENT });
});
