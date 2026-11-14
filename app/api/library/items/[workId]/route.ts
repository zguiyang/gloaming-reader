import { getLibraryItem } from '@/server/domains/library/service';
import { jsonOk } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { requireIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ workId: string }> };

export const GET = withApiError(async (request: Request, context: Ctx) => {
  const identity = await requireIdentity(request);
  const workId = pathId((await context.params).workId, 'workId');
  return jsonOk(await getLibraryItem(identity.user.id, workId));
});
